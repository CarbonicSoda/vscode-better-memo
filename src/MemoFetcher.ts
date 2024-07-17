import { window, workspace, Disposable, TextDocument } from "vscode";
import * as EE from "./utils/EventEmitter";
import ConfigMaid from "./utils/ConfigMaid";
import LangComments from "./lang-comments.json";

export default class MemoFetcher {
	public tags: Set<string> = new Set();
	public memos: Map<TextDocument, MemoEntry[]> = new Map();

	private _watchedDocs: TextDocument[] = [];
	private _memoChanges: Map<TextDocument, MemoEntry[]> = new Map();

	private _intervals: NodeJS.Timeout[] = [];
	private _disposables: (Disposable | EE.Disposable)[] = [];
	private _docVersions: Map<TextDocument, number> = new Map();

	public async init() {
		ConfigMaid.listen("watch", (watch) => `{${watch.join(",")}}`);
		ConfigMaid.listen("ignore", (ignore) => `{${ignore.join(",")}}`);
		ConfigMaid.listen("scanDelay");

		await this._fetchDocs();
		this._disposables.push(
			workspace.onDidCreateFiles(() => {
				this._fetchDocs();
			}),
			workspace.onDidDeleteFiles((ev) => {
				const deletedFsPaths = ev.files.map((uri) => uri.fsPath);
				this._watchedDocs = this._watchedDocs.filter(
					(doc) => !deletedFsPaths.includes(doc.fileName),
				);
			}),
		);

		this._watchedDocs.forEach((doc) => this._scanDoc(doc));
		this._disposables.push(
			workspace.onDidSaveTextDocument((doc) => {
				if (this._scanValid(doc, true)) this._scanDoc(doc, true);
			}),
		);

		this._intervals.push(
			setInterval(() => {
				const doc = window.activeTextEditor?.document;
				if (this._scanValid(doc)) this._scanDoc(doc, true);
			}, ConfigMaid.get("scanDelay")),
		);

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
		for (const interval of this._intervals) clearInterval(interval);
		for (const disposable of this._disposables) disposable.dispose();
	}

	private async _fetchDocs() {
		this._watchedDocs = await Promise.all(
			await workspace
				.findFiles(ConfigMaid.get("watch"), ConfigMaid.get("ignore"))
				.then((files) => files.map((file) => workspace.openTextDocument(file))),
		).catch((reason) => {
			throw new Error(`Better Memo $Error when fetching documents: ${reason}`);
		});
	}
	private _scanDoc(doc: TextDocument, updateWebview?: boolean) {
		const content = doc.getText();
		const commentData = LangComments[<keyof typeof LangComments>doc.languageId];
		if (!commentData) return;
		const commentClose = commentData[<keyof typeof commentData>"close"];
		const matchPattern = new RegExp(
			`${commentData.open}\\s*mo\\s+(?<tag>\\S+)\\s+(?<content>.*)${commentClose ?? "$"}`,
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
		if (memos.length === 0) return;
		this.memos.set(doc, memos);
		this._memoChanges.set(doc, memos);
		if (updateWebview) EE.EventEmitter.evoke("updateWebviewContent", this.getChanges());
	}
	private _scanValid(doc: TextDocument | undefined, didSave?: boolean) {
		const valid =
			(didSave ? true : doc?.isDirty) &&
			doc.version !== this._docVersions.get(doc) &&
			this._watchedDocs.includes(doc);
		if (valid) this._docVersions.set(doc, doc.version);
		return valid;
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
