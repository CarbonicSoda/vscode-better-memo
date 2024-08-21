import { commands, TabGroup, TextDocument, window, workspace } from "vscode";
import { EE } from "./utils/event-emitter";
import { FE } from "./utils/file-edit";
import { getConfigMaid } from "./utils/config-maid";
import { IntervalMaid } from "./utils/interval-maid";
import { Janitor } from "./utils/janitor";
import LangComments from "./lang-comments.json";
import PresetTags from "./preset-tags.json";

const eventEmitter = EE.getEventEmitter();
const configMaid = getConfigMaid();

export class MemoFetcher {
	readonly closeCharacters = Array.from(
		new Set(
			Object.values(LangComments)
				//@ts-ignore
				.map((data) => data.close)
				.join("")
				.split(""),
		),
	).join("");

	private watchedDocs: Map<TextDocument, { version: number; lang: string }> = new Map();
	private docMemos: Map<TextDocument, MemoEntry[]> = new Map();
	private tags: Set<string> = new Set(Object.keys(PresetTags));
	private janitor = new Janitor();
	private intervalMaid = new IntervalMaid();
	private forceScanSuppressed = false;
	private prevDoc: TextDocument;

	async init() {
		configMaid.listen({
			"fetcher.watch": (watch) => `{${watch.join(",")}}`,
			"fetcher.ignore": (ignore) => `{${ignore.join(",")}}`,
		});
		configMaid.listen("fetcher.forceScanDelay");
		await this.fetchDocs();
		for (const doc of this.watchedDocs.keys()) this.scanDoc(doc);

		this.janitor.add(
			workspace.onDidCreateFiles(() => this.fetchDocs(true)),
			workspace.onDidDeleteFiles(() => this.fetchDocs(true)),

			workspace.onDidSaveTextDocument(async (doc) => {
				if (this.validForScan(doc)) this.scanDoc(doc, true);
			}),
			window.tabGroups.onDidChangeTabGroups((ev) => this.handleTabChange(ev.changed)),
		);
		this.intervalMaid.add(() => {
			const doc = window.activeTextEditor?.document;
			if (!doc) return;
			this.prevDoc = doc;
			if (this.validForScan(doc)) this.scanDoc(doc, true);
		}, "fetcher.scanDelay");
		this.intervalMaid.add(() => {
			if (this.forceScanSuppressed) return;
			const doc = window.activeTextEditor?.document;
			if (!doc || !this.watchedDocs.has(doc)) return;
			this.scanDoc(doc, true);
		}, "fetcher.forceScanDelay");
		this.intervalMaid.add(() => this.fetchDocs(true), "fetcher.workspaceScanDelay");
		eventEmitter.emitWait("fetcherInitFinished");
	}
	getMemos() {
		const memos = Array.from(this.docMemos.values()).flat();
		commands.executeCommand("setContext", "better-memo.noMemos", memos.length === 0);
		return memos;
	}
	getTags() {
		return Array.from(this.tags.values());
	}
	suppressForceScan() {
		this.forceScanSuppressed = true;
	}
	unsuppressForceScan() {
		this.forceScanSuppressed = false;
	}
	dispose() {
		this.janitor.clearAll();
		this.intervalMaid.dispose();
	}

	private async fetchDocs(refreshMemos?: boolean) {
		const documents: TextDocument[] = (
			await Promise.all(
				await workspace.findFiles(configMaid.get("fetcher.watch"), configMaid.get("fetcher.ignore")).then((files) =>
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
		this.watchedDocs.clear();
		for (const doc of documents) this.watchedDocs.set(doc, { version: doc.version, lang: doc.languageId });
		if (!refreshMemos) return;
		for (const doc of this.docMemos.keys()) if (!this.watchedDocs.has(doc)) this.docMemos.delete(doc);
		for (const doc of this.watchedDocs.keys()) if (!this.docMemos.has(doc)) this.scanDoc(doc);
	}
	private async scanDoc(doc: TextDocument, updateView?: boolean) {
		const content = doc.getText();
		const langId = <keyof typeof LangComments>doc.languageId;
		const commentData = LangComments[langId];
		//@ts-ignore
		const close = reEscape(commentData.close) ?? "";
		const matchPattern = new RegExp(
			`${reEscape(commentData.open)}[\t ]*mo[\t ]+(?<tag>[^\\r\\n\t ${reEscape(
				this.closeCharacters,
			)}]+)[\t ]*(?<priority>!*)(?<content>.*${close ? "?" : ""})${close}`,
			"gim",
		);
		let memos = [];
		const leftoverCloseCharacters = new RegExp(`^[${reEscape(this.closeCharacters)}]*`);
		for (const match of content.matchAll(matchPattern)) {
			const [tag, priority, content] = [
				match.groups["tag"].toUpperCase(),
				match.groups["priority"].length,
				match.groups["content"].trimEnd().replace(leftoverCloseCharacters, ""),
			];
			this.tags.add(tag);
			memos.push({
				content: content,
				tag: tag,
				priority: priority,
				path: doc.fileName,
				relativePath: workspace.asRelativePath(doc.fileName),
				line: doc.positionAt(match.index).line,
				offset: match.index,
				rawLength: match[0].length,
				raw: match[0],
				langId: langId,
			});
		}
		this.docMemos.set(doc, memos);
		if (updateView) eventEmitter.emit("updateView");
	}
	private async formatMemos(doc: TextDocument, background?: boolean) {
		const memos = this.docMemos.get(doc);
		if (!memos) return;
		const edit = new FE.FileEdit();
		for (const memo of memos)
			edit.replace(doc.uri, [memo.offset, memo.offset + memo.rawLength], getFormattedMemo(memo));
		edit.apply({ isRefactoring: true }, background);
	}
	private async handleTabChange(changed: readonly TabGroup[]) {
		if (!this.prevDoc || !this.watchedDocs.has(this.prevDoc) || changed.length !== 1) return;
		const tabGroup = changed[0];
		const activeTab = tabGroup.activeTab;
		const input = activeTab?.input;
		if (
			!tabGroup.isActive ||
			(activeTab && !activeTab?.isActive) ||
			(input && Object.getPrototypeOf(input).constructor.name !== "Kn")
		)
			return;
		if (this.prevDoc.isDirty) return;
		if (this.validForScan(this.prevDoc)) await this.scanDoc(this.prevDoc, true);
		this.formatMemos(this.prevDoc, true);
		if (!input) return;
		//@ts-ignore
		workspace.openTextDocument(input.uri).then((doc) => {
			this.prevDoc = doc;
		});
	}
	private validForScan(doc?: TextDocument) {
		const watched = this.watchedDocs.get(doc);
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
	readonly priority: number;
	readonly path: string;
	readonly relativePath: string;
	readonly line: number;
	readonly offset: number;
	readonly rawLength: number;
	readonly raw: string;
	readonly langId: keyof typeof LangComments;
};

export function getFormattedMemo(memo: MemoEntry) {
	const commentData = LangComments[memo.langId];
	//@ts-ignore
	const padding = commentData.close ? " " : "";
	return `${commentData.open}${padding}MO ${memo.tag}${memo.content ? " " : ""}${"!".repeat(memo.priority)}${
		memo.content
	}${padding}${
		//@ts-ignore
		commentData.close ?? ""
	}`;
}

const reEscape = (str?: string) => str?.replace(/[[\]*+?{}.()^$|/\\-]/g, "\\$&");
