import { commands, window, workspace, TextDocument, WorkspaceEdit, Range } from "vscode";
import { EventEmitter } from "./utils/EventEmitter";
import Janitor from "./utils/Janitor";
import ConfigMaid from "./utils/ConfigMaid";
import IntervalMaid from "./utils/IntervalMaid";
import LangComments from "./lang-comments.json";

export class MemoFetcher {
	private _watchedDocs: Map<TextDocument, { version: number; lang: string }> = new Map();
	private _docMemos: Map<TextDocument, MemoEntry[]> = new Map();
	private _tags: Set<string> = new Set();
	private _janitor = new Janitor();
	private _intervalMaid = new IntervalMaid();
	private _prevDoc?: TextDocument;

	public async init() {
		ConfigMaid.listen({
			"fetcher.watch": (watch) => `{${watch.join(",")}}`,
			"fetcher.ignore": (ignore) => `{${ignore.join(",")}}`,
		});
		await this._fetchDocs();
		for (const doc of this._watchedDocs.keys()) this._scanDoc(doc);
		this._janitor.add(
			workspace.onDidCreateFiles(() => this._fetchDocs(true)),
			workspace.onDidDeleteFiles(() => this._fetchDocs(true)),

			workspace.onDidSaveTextDocument((doc) => {
				if (this._validForScan(doc)) {
					this._scanDoc(doc, true);
					this._formatMemos(doc);
				}
			}),
			window.onDidChangeVisibleTextEditors((editors) => {
				if (editors.length !== 0 || !this._prevDoc) return;
				if (this._validForScan(this._prevDoc)) {
					this._scanDoc(this._prevDoc, true);
					this._formatMemos(this._prevDoc);
				}
			}),
			window.onDidChangeActiveTextEditor((editor) => this._formatMemos(editor.document)),
		);
		this._intervalMaid.add(() => {
			const doc = window.activeTextEditor?.document;
			if (!doc) return;
			this._prevDoc = doc;
			if (this._validForScan(doc)) this._scanDoc(doc, true);
		}, "fetcher.scanDelay");
		this._intervalMaid.add(() => this._fetchDocs(true), "fetcher.workspaceScanDelay");

		EventEmitter.emitWait("fetcherInit");
	}
	public getMemos() {
		const memos = Array.from(this._docMemos.values()).flat();
		commands.executeCommand("setContext", "better-memo.noMemos", memos.length === 0);
		return memos;
	}
	public getTags() {
		return Array.from(this._tags.values());
	}
	public dispose() {
		this._janitor.clearAll();
		this._intervalMaid.dispose();
	}

	private async _fetchDocs(refreshMemos?: boolean) {
		const documents: TextDocument[] = (
			await Promise.all(
				await workspace
					.findFiles(ConfigMaid.get("fetcher.watch"), ConfigMaid.get("fetcher.ignore"))
					.then((files) =>
						files.map((file) =>
							workspace.openTextDocument(file).then(
								(doc) => doc,
								() => null,
							),
						),
					),
			).catch((err) => {
				throw new Error(`Error when fetching documents: ${err}`);
			})
		).filter((doc) => Object.hasOwn(LangComments, doc?.languageId));
		commands.executeCommand("setContext", "better-memo.noFiles", documents.length === 0);
		this._watchedDocs.clear();
		for (const doc of documents) this._watchedDocs.set(doc, { version: doc.version, lang: doc.languageId });
		if (!refreshMemos) return;
		for (const doc of this._docMemos.keys()) if (!this._watchedDocs.has(doc)) this._docMemos.delete(doc);
		for (const doc of this._watchedDocs.keys()) if (!this._docMemos.has(doc)) this._scanDoc(doc);
	}
	private _scanDoc(doc: TextDocument, updateView?: boolean) {
		const rawString = (str?: string) => str?.replaceAll("", "\\").slice(0, -1);
		const content = doc.getText();
		const commentData = LangComments[<keyof typeof LangComments>doc.languageId];
		const matchPattern = new RegExp(
			`${rawString(commentData.open)}[ \t]*mo[ \t]+(?<tag>\\S+)[ \t]*(?<content>.*)${
				//@ts-ignore
				rawString(commentData.close) ?? ""
			}`,
			"gim",
		);
		let _memos = [];
		for (const match of content.matchAll(matchPattern)) {
			const [tag, content] = [match.groups["tag"].toUpperCase(), match.groups["content"].trimEnd()];
			this._tags.add(tag);
			_memos.push({
				content: content,
				tag: tag,
				path: doc.fileName,
				relativePath: workspace.asRelativePath(doc.fileName),
				line: doc.positionAt(match.index).line + 1,
				offset: match.index,
				rawLength: match[0].length,
			});
		}
		this._docMemos.set(doc, _memos);
		if (updateView) EventEmitter.emit("updateView");
	}
	private _formatMemos(doc: TextDocument) {
		const memos = this._docMemos.get(doc);
		if (!memos) return;
		const edit = new WorkspaceEdit();
		for (const memo of memos) {
			const commentData = LangComments[<keyof typeof LangComments>doc.languageId];
			//@ts-ignore
			const padding = commentData.close ? " " : "";
			const newMemo = `${commentData.open}${padding}MO ${memo.tag}${memo.content ? " " : ""}${
				memo.content
			}${padding}${
				//@ts-ignore
				commentData.close ?? ""
			}`;
			const editStart = doc.positionAt(memo.offset);
			const editEnd = editStart.translate(0, memo.rawLength);
			edit.replace(doc.uri, new Range(editStart, editEnd), newMemo);
		}
		workspace.applyEdit(edit);
	}
	private _validForScan(doc?: TextDocument) {
		const watched = this._watchedDocs.get(doc);
		if (!watched) return false;
		const versionChanged = doc.version !== watched.version;
		const langChanged = doc.languageId !== watched.lang;
		if (versionChanged) watched.version = doc.version;
		if (langChanged) watched.lang = doc.languageId;
		return versionChanged || langChanged;
	}
}

export type MemoEntry = {
	readonly content: string;
	readonly tag: string;
	readonly path: string;
	readonly relativePath: string;
	readonly line: number;
	readonly offset: number;
	readonly rawLength: number;
};
