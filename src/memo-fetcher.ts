import { commands, TabGroup, TextDocument, ThemeColor, window, workspace } from "vscode";
import { Aux } from "./utils/auxiliary";
import { getColorMaid } from "./utils/color-maid";
import { getConfigMaid } from "./utils/config-maid";
import { EventEmitter } from "./utils/event-emitter";
import { FE } from "./utils/file-edit";
import { IntervalMaid } from "./utils/interval-maid";
import { Janitor } from "./utils/janitor";

import LangCommentFormat from "./lang-comment-format.json";

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
	readonly langId: keyof typeof LangCommentFormat;
};

const eventEmitter = EventEmitter.getEventEmitter();
const colorMaid = getColorMaid();
const configMaid = getConfigMaid();

export class MemoFetcher {
	customTags: { [tag: string]: ThemeColor } = {};
	readonly closeCharacters = Array.from(
		new Set(
			Object.values(LangCommentFormat)
				.flat()
				.map((data) => (<{ open: string; close?: string }>data).close)
				.join("")
				.split(""),
		),
	).join("");

	private watchedDocs: Map<TextDocument, { version: number; lang: string }> = new Map();
	private docMemos: Map<TextDocument, MemoEntry[]> = new Map();
	private janitor = new Janitor();
	private intervalMaid = new IntervalMaid();
	private forceScanSuppressed = false;
	private prevDoc: TextDocument;

	async init(): Promise<void> {
		configMaid.listen("general.customTags");
		configMaid.listen({
			"fetcher.watch": (watch) => `{${watch.join(",")}}`,
			"fetcher.ignore": (ignore) => `{${ignore.join(",")}}`,
		});
		configMaid.listen("fetcher.forceScanDelay");

		await this.forceScan();

		this.janitor.add(
			configMaid.onChange("general.customTags", () => eventEmitter.emit("updateView")),

			//add eventEmitter event listener for scanDoc to prevent ghost memos after completion

			workspace.onDidCreateFiles(() => this.fetchDocs()),
			workspace.onDidDeleteFiles(() => this.fetchDocs()),

			workspace.onDidSaveTextDocument(async (doc) => {
				if (this.validForScan(doc)) this.scanDoc(doc, true);
			}),
			window.tabGroups.onDidChangeTabGroups((ev) => this.handleTabChange(ev.changed)),

			commands.registerCommand("better-memo.reloadExplorer", () => this.forceScan(true)),
		);
		this.intervalMaid.add(() => this.scanDocInterval(), "fetcher.scanDelay");
		this.intervalMaid.add(() => this.forceScanInterval(), "fetcher.forceScanDelay");
		this.intervalMaid.add(() => this.fetchDocs(), "fetcher.workspaceScanDelay");

		eventEmitter.emitWait("fetcherInitFinished");
	}

	getMemos(): MemoEntry[] {
		const memos = Array.from(this.docMemos.values()).flat();
		commands.executeCommand("setContext", "better-memo.noMemos", memos.length === 0);
		return memos;
	}

	getTags(): { [tag: string]: ThemeColor } {
		this.fetchCustomTags();
		let tags: { [tag: string]: ThemeColor } = {};
		const memoTags = this.getMemos().map((memo) => memo.tag);
		for (const tag of memoTags) tags[tag] = colorMaid.hashColor(tag);
		return Object.assign(tags, this.customTags);
	}

	suppressForceScan(): void {
		this.forceScanSuppressed = true;
	}

	unsuppressForceScan(): void {
		this.forceScanSuppressed = false;
	}

	dispose(): void {
		this.janitor.clearAll();
		this.intervalMaid.dispose();
	}

	private fetchCustomTags(): void {
		const userDefinedCustomTags = configMaid.get("general.customTags");
		const validTagRE = new RegExp(`^[^\\r\\n\t ${Aux.reEscape(this.closeCharacters)}]+$`);
		const validHexRE = /(?:^#?[0-9a-f]{6}$)|(?:^#?[0-9a-f]{3}$)/i;
		const validCustomTags: { [tag: string]: ThemeColor } = {};
		for (let [tag, hex] of Object.entries(userDefinedCustomTags)) {
			[tag, hex] = [tag.trim().toUpperCase(), (<string>hex).trim()];
			if (!validTagRE.test(tag) || !validHexRE.test(<string>hex)) continue;
			validCustomTags[tag] = colorMaid.interpolate(<string>hex);
		}
		this.customTags = validCustomTags;
	}

	private async scanDocInterval(): Promise<void> {
		const doc = window.activeTextEditor?.document;
		if (!doc) return;
		this.prevDoc = doc;
		if (this.validForScan(doc)) await this.scanDoc(doc, true);
	}

	private async forceScanInterval(): Promise<void> {
		if (this.forceScanSuppressed) return;
		const doc = window.activeTextEditor?.document;
		if (!doc || !this.watchedDocs.has(doc)) return;
		await this.scanDoc(doc, true);
	}

	private async forceScan(updateView?: boolean): Promise<void> {
		await this.fetchDocs().then(() => {
			for (const doc of this.watchedDocs.keys()) this.scanDoc(doc);
			if (updateView) eventEmitter.emit("updateView");
		});
	}

	private async formatMemos(doc: TextDocument): Promise<void> {
		const memos = this.docMemos.get(doc);
		if (!memos) return;
		const edit = new FE.FileEdit();
		for (const memo of memos)
			edit.replace(doc.uri, [memo.offset, memo.offset + memo.rawLength], getFormattedMemo(memo));
		edit.apply({ isRefactoring: true });
	}

	private async handleTabChange(changed: readonly TabGroup[]): Promise<void> {
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
		this.formatMemos(this.prevDoc);
		if (!input) return;
		//@ts-ignore
		workspace.openTextDocument(input.uri).then((doc) => {
			this.prevDoc = doc;
		});
	}

	private async fetchDocs(): Promise<void> {
		const documents: TextDocument[] = (
			await Promise.all(
				await workspace
					.findFiles(configMaid.get("fetcher.watch"), configMaid.get("fetcher.ignore"))
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
		).filter((doc) => Object.hasOwn(LangCommentFormat, doc?.languageId));
		commands.executeCommand("setContext", "better-memo.noFiles", documents.length === 0);
		this.watchedDocs.clear();
		for (const doc of documents) this.watchedDocs.set(doc, { version: doc.version, lang: doc.languageId });
		for (const doc of this.docMemos.keys()) if (!this.watchedDocs.has(doc)) this.docMemos.delete(doc);
		for (const doc of this.watchedDocs.keys()) if (!this.docMemos.has(doc)) this.scanDoc(doc);
	}

	private async scanDoc(doc: TextDocument, updateView?: boolean): Promise<void> {
		const content = doc.getText();
		const langId = <keyof typeof LangCommentFormat>doc.languageId;
		const commentFormats: { open: string; close?: string }[] = [LangCommentFormat[langId]].flat();
		const matchPatternRaw =
			"(?:" +
			commentFormats
				.map((data, i) => {
					const open = Aux.reEscape(data.open);
					const close = Aux.reEscape(data.close ?? "");
					return `(?<![${open}])${open}[\t ]*mo[\t ]+(?<tag${i}>[^\\r\\n\\t ${Aux.reEscape(
						this.closeCharacters,
					)}]+)[\\t ]*(?<priority${i}>!*)(?<content${i}>.*${close ? "?" : ""})${close}`;
				})
				.join(")|(?:") +
			")";
		const matchPattern = new RegExp(matchPatternRaw, "gim");
		let memos = [];
		for (const match of content.matchAll(matchPattern)) {
			let tag;
			let priority;
			let content;
			for (const [groupName, value] of Object.entries(match.groups)) {
				if (value === undefined) continue;
				if (groupName.startsWith("tag")) {
					tag = value.toUpperCase();
					continue;
				}
				if (groupName.startsWith("priority")) {
					priority = value.length;
					continue;
				}
				if (groupName.startsWith("content")) {
					content = value.trimEnd();
					continue;
				}
				break;
			}
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

	private validForScan(doc?: TextDocument): boolean {
		const watched = this.watchedDocs.get(doc);
		if (!watched) return false;
		const versionChanged = doc.version !== watched.version;
		const langChanged = doc.languageId !== watched.lang;
		if (versionChanged) watched.version = doc.version;
		if (langChanged) watched.lang = doc.languageId;
		return versionChanged || langChanged;
	}
}

export function getFormattedMemo(memo: MemoEntry): string {
	const commentFormat: { open: string; close?: string } = [LangCommentFormat[memo.langId]].flat()[0];
	const padding = commentFormat.close ? " " : "";
	return `${commentFormat.open}${padding}MO ${memo.tag}${memo.content ? " " : ""}${"!".repeat(memo.priority)}${
		memo.content
	}${padding}${commentFormat.close ?? ""}`;
}
