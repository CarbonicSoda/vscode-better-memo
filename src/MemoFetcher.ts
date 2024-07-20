import { window, workspace, TextDocument } from "vscode";
import { EventEmitter } from "./utils/EventEmitter";
import Janitor from "./utils/Janitor";
import ConfigMaid from "./utils/ConfigMaid";
import IntervalMaid from "./utils/IntervalMaid";
import LangComments from "./lang-comments.json";

export class MemoFetcher {
	private _watchedDocs: Map<TextDocument, { version: number; lang: string }> = new Map();
	private _docMemos: Map<TextDocument, { memos: MemoEntry[]; changes: MemoEntry[] }> = new Map();
	private _tags: Set<string> = new Set();
	private _janitor = new Janitor();
	private _intervalMaid = new IntervalMaid();

	public async init() {
		ConfigMaid.listen({
			watch: (watch) => `{${watch.join(",")}}`,
			ignore: (ignore) => `{${ignore.join(",")}}`,
		});
		await this._fetchDocs();
		for (const doc of this._watchedDocs.keys()) this._scanDoc(doc);
		this._janitor.add(
			workspace.onDidCreateFiles(() => {
				this._fetchDocs(true);
			}),
			workspace.onDidDeleteFiles(() => {
				this._fetchDocs(true);
			}),

			workspace.onWillSaveTextDocument((ev) => {
				const doc = ev.document;
				if (doc.isDirty && this._validForScan(doc)) this._scanDoc(doc, true);
			}),
		);
		this._intervalMaid.add(() => {
			const doc = window.activeTextEditor?.document;
			if (!doc) return;
			if (this._validForScan(doc)) this._scanDoc(doc, true);
		}, "scanDelay");
		this._intervalMaid.add(() => {
			this._fetchDocs(true);
		}, "workspaceScanDelay");

		EventEmitter.emit("loadWebviewContent", this.getMemos(), this.getTags());
	}
	public getMemos() {
		const memos: { [fileName: string]: MemoEntry[] } = {};
		for (const [doc, info] of this._docMemos.entries()) memos[doc.fileName] = info.memos;
		return memos;
	}
	public getChanges() {
		const changes: { [fileName: string]: MemoEntry[] } = {};
		for (const [doc, info] of this._docMemos.entries()) {
			changes[doc.fileName] = info.changes;
			info.changes = [];
		}
		return changes;
	}
	public getTags() {
		return [...this._tags.values()];
	}
	public dispose() {
		this._janitor.clearAll();
		this._intervalMaid.dispose();
	}

	private async _fetchDocs(refreshMemos?: boolean) {
		const documents: TextDocument[] = (
			await Promise.all(
				await workspace
					.findFiles(ConfigMaid.get("watch"), ConfigMaid.get("ignore"))
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
		this._watchedDocs.clear();
		for (const doc of documents) this._watchedDocs.set(doc, { version: doc.version, lang: doc.languageId });
		if (!refreshMemos) return;
		for (const doc of this._docMemos.keys()) if (!this._watchedDocs.has(doc)) this._docMemos.delete(doc);
		for (const doc of this._watchedDocs.keys()) if (!this._docMemos.has(doc)) this._scanDoc(doc);
	}
	private _scanDoc(doc: TextDocument, updateWebview?: boolean) {
		const content = doc.getText();
		//@ts-ignore
		const commentData = LangComments[doc.languageId];
		const matchPattern = new RegExp(
			`${commentData.open}\\s*mo\\s+(?<tag>\\S+)\\s+(?<content>.*?)${
				//@ts-ignore
				commentData["close"] ?? "$"
			}`,
			"gim",
		);
		let _memos = [];
		for (const match of content.matchAll(matchPattern)) {
			const [tag, content] = [match.groups["tag"], match.groups["content"].trimEnd()];
			this._tags.add(tag);
			_memos.push({
				content: content,
				tag: tag,
				path: workspace.asRelativePath(doc.fileName),
				line: doc.positionAt(match.index).line + 1,
				_offset: match.index,
				_rawLength: match[0].length,
			});
		}
		this._docMemos.set(doc, { memos: _memos, changes: _memos });
		if (updateWebview) EventEmitter.emit("updateWebviewContent", this.getChanges(), this.getTags());
	}
	private _validForScan(doc: TextDocument) {
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
	readonly line: number;
	readonly _offset: number;
	readonly _rawLength: number;
};
