import { window, workspace, TextDocument } from "vscode";
import * as EE from "./utils/EventEmitter";
import Janitor from "./utils/Janitor";
import ConfigMaid from "./utils/ConfigMaid";
import IntervalMaid from "./utils/IntervalMaid";
import LangComments from "./lang-comments.json";

export default class MemoFetcher {
	public tags: Set<string> = new Set();
	public memos: Map<TextDocument, MemoEntry[]> = new Map();

	private _memoChanges: Map<TextDocument, MemoEntry[]> = new Map();
	private _watchedDocs: Map<TextDocument, { _version: number; _lang: string }> = new Map();
	private _janitor = new Janitor();
	private _intervalMaid = new IntervalMaid();

	public async init() {
		ConfigMaid.listen({
			watch: (watch) => `{${watch.join(",")}}`,
			ignore: (ignore) => `{${ignore.join(",")}}`,
		});
		await this._fetchDocs(true);
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

		EE.EventEmitter.evoke("loadWebviewContent", this.getChanges());
	}
	public getChanges() {
		const changes: { [fileName: string]: MemoEntry[] } = {};
		this._memoChanges.forEach((memos, doc) => {
			changes[doc.fileName] = memos;
		});
		this._memoChanges.clear();
		return changes;
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
		for (const doc of documents)
			this._watchedDocs.set(doc, { _version: doc.version, _lang: doc.languageId });

		if (!refreshMemos) return;
		for (const doc of this.memos.keys()) if (!this._watchedDocs.has(doc)) this.memos.delete(doc);
		for (const doc of this._memoChanges.keys())
			if (!this._watchedDocs.has(doc)) this._memoChanges.delete(doc);
		for (const doc of this._watchedDocs.keys()) if (!this.memos.has(doc)) this._scanDoc(doc);
	}
	private _scanDoc(doc: TextDocument, updateWebview?: boolean) {
		const content = doc.getText();
		//@ts-ignore
		const commentData = LangComments[doc.languageId];
		const matchPattern = new RegExp(
			`${commentData.open}\\s*mo\\s+(?<tag>\\S+)\\s+(?<content>.*)${
				//@ts-ignore
				commentData["close"] ?? "$"
			}`,
			"gim",
		);

		let memos = [];
		for (const match of content.matchAll(matchPattern)) {
			const [tag, content] = [match.groups["tag"], match.groups["content"].trimEnd()];
			this.tags.add(tag);
			memos.push({
				content: content,
				tag: tag,
				file: doc,
				line: doc.positionAt(match.index).line + 1,
				_offset: match.index,
				_rawLength: match[0].length,
			});
		}
		this.memos.set(doc, memos);
		this._memoChanges.set(doc, memos);

		if (updateWebview) EE.EventEmitter.evoke("updateWebviewContent", this.getChanges());
	}
	private _validForScan(doc: TextDocument) {
		const watched = this._watchedDocs.get(doc);
		const versionChanged = doc.version !== watched._version;
		const langChanged = doc.languageId !== watched._lang;
		if (versionChanged) watched._version = doc.version;
		if (langChanged) watched._lang = doc.languageId;
		return watched && (versionChanged || langChanged);
	}
}

type MemoEntry = {
	readonly content: string;
	readonly tag: string;
	readonly file: TextDocument;
	readonly line: number;
	readonly _offset: number;
	readonly _rawLength: number;
};
