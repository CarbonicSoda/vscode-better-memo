import { commands, TabGroup, TextDocument, ThemeColor, window, workspace } from "vscode";
import { Aux } from "./utils/auxiliary";
import { ColorMaid, getColorMaid } from "./utils/color-maid";
import { ConfigMaid } from "./utils/config-maid";
import { EvEmitter } from "./utils/event-emitter";
import { FEdit } from "./utils/file-edit";
import { IntervalMaid } from "./utils/interval-maid";
import { Janitor } from "./utils/janitor";

import LangCommentFormat from "./json/lang-comment-format.json";

export type MemoEntry = {
	readonly content: string;
	readonly tag: string;
	readonly priority: number;
	readonly line: number;
	readonly offset: number;
	readonly path: string;
	readonly relativePath: string;
	readonly langId: keyof typeof LangCommentFormat;
	readonly raw: string;
	readonly rawLength: number;
};

let commentCloseCharacters: string;
let colorMaid: ColorMaid;
let configMaid: ConfigMaid;
let eventEmitter: EvEmitter.EventEmitter;

let resolved = false;
export async function resolver(): Promise<void> {
	if (resolved) return;
	resolved = true;

	commentCloseCharacters = await Aux.reEscape(
		[
			...new Set(
				(
					await Promise.all(
						Object.values(LangCommentFormat)
							.flat()
							.map(async (data) => (<{ open: string; close?: string }>data).close),
					)
				)
					.join("")
					.split(""),
			),
		].join(""),
	);

	colorMaid = await getColorMaid();
	configMaid = new ConfigMaid();
	eventEmitter = await EvEmitter.getEventEmitter();

	await Promise.all([
		configMaid.listen("general.customTags"),

		configMaid.listen({
			"fetcher.watch": async (watch) => `{${watch.join(",")}}`,
			"fetcher.ignore": async (ignore) => `{${ignore.join(",")}}`,
		}),
	]);

	await configMaid.onChange("general.customTags", async () => await eventEmitter.emit("updateView"));
}

export class MemoFetcher {
	customTags: { [tag: string]: ThemeColor } = {};

	private watchedDocs: Map<TextDocument, { version: number; lang: string }> = new Map();
	private docMemos: Map<TextDocument, MemoEntry[]> = new Map();

	private prevDoc: TextDocument;

	private forceScanSuppressed = false;

	private backgroundScanQueue: Set<TextDocument> = new Set();
	private backgroundMode = false;

	private janitor = new Janitor();
	private intervalMaid = new IntervalMaid();

	static async getFormattedMemo(memo: MemoEntry): Promise<string> {
		const commentFormat: { open: string; close?: string } = [LangCommentFormat[memo.langId]].flat()[0];
		const padding = commentFormat.close ? " " : "";
		return `${commentFormat.open}${padding}MO ${memo.tag}${memo.content ? " " : ""}${"!".repeat(memo.priority)}${
			memo.content
		}${padding}${commentFormat.close ?? ""}`;
	}

	async init(): Promise<void> {
		await this.loadMemos();

		await this.janitor.add(
			workspace.onDidCreateFiles(async () => await this.fetchDocs()),
			workspace.onDidDeleteFiles(async () => await this.fetchDocs()),

			workspace.onDidSaveTextDocument(async (doc) => {
				if (this.validateForScan(doc)) this.scanDoc(doc, { updateView: true }); //maybe use another priv func lol
			}),
			window.tabGroups.onDidChangeTabGroups(async (ev) => await this.handleTabChange(ev.changed)),

			commands.registerCommand(
				"better-memo.reloadExplorer",
				async () => await this.loadMemos({ updateView: true }),
			),
		);

		await Promise.all([
			this.intervalMaid.add(async () => await this.scanDocInterval(), "fetcher.scanDelay"),
			this.intervalMaid.add(async () => await this.forceScanInterval(), "fetcher.forceScanDelay"),
			this.intervalMaid.add(async () => await this.fetchDocs(), "fetcher.workspaceScanDelay"),
		]);

		eventEmitter.emitWait("initExplorerView");
		eventEmitter.emitWait("initTextEditorCommands");
	}

	async scanDoc(doc: TextDocument, options?: { updateView?: boolean }): Promise<void> {
		if (this.backgroundMode) {
			this.backgroundScanQueue.add(doc);
			return;
		}
		const docContent = doc.getText();
		const langId = <keyof typeof LangCommentFormat>doc.languageId;
		const commentFormats: { open: string; close?: string }[] = [LangCommentFormat[langId]].flat();
		const uCommentFormatREs = commentFormats.map(async (data, i) => {
			const open = await Aux.reEscape(data.open);
			const close = await Aux.reEscape(data.close ?? "");
			return `(?<![${open}])${open}[\\t ]*mo[\\t ]+(?<tag${i}>[^\\r\\n\\t ${commentCloseCharacters}]+)[\\t ]*(?<priority${i}>!*)(?<content${i}>.*${
				close ? "?" : ""
			})${close}`;
		});
		const matchPatternRaw = `(?:${(await Promise.all(uCommentFormatREs)).join(")|(?:")})`;
		const matchPattern = RegExp(matchPatternRaw, "gim");

		let memos = [];
		for (const match of docContent.matchAll(matchPattern)) {
			let tag: string;
			let priority: number;
			let content: string;
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
		if (options?.updateView) eventEmitter.emit("updateView");
	}

	async getMemos(): Promise<MemoEntry[]> {
		const memos = [...this.docMemos.values()].flat();
		await commands.executeCommand("setContext", "better-memo.noMemos", memos.length === 0);
		return memos;
	}

	async getMemosInDoc(doc: TextDocument): Promise<MemoEntry[]> {
		return this.docMemos.get(doc);
	}

	async removeMemos(...memos: MemoEntry[]): Promise<void> {
		for (const memo of memos) {
			for (const [doc, _memos] of this.docMemos.entries()) {
				if (!_memos.includes(memo)) return;
				const memoIndex = _memos.indexOf(memo);
				const removed = _memos.filter((_, i) => i !== memoIndex);
				this.docMemos.set(doc, removed);
			}
		}
		// for (const path of Object.keys(Aux.groupObjects(memos, "path")))
		// 	workspace.openTextDocument(path).then(async (doc) => await this.scanDoc(doc));
	}

	async removeAllMemos(): Promise<void> {
		this.docMemos.clear();
	}

	async includes(memo: MemoEntry): Promise<boolean> {
		for (const _memo of this.docMemos.values()) if (JSON.stringify(memo) === JSON.stringify(_memo)) return true;
		return false;
	}

	async getTags(): Promise<{ [tag: string]: ThemeColor }> {
		await this.fetchCustomTags();
		const tags = await Promise.all((await this.getMemos()).map(async (memo) => memo.tag));
		const uMemoTags = {};
		for (const tag of tags)
			if (!this.customTags[tag]) uMemoTags[tag] = colorMaid.hashColor(tag)
		await Promise.all(Object.values(uMemoTags));
		return Object.assign(uMemoTags, this.customTags);
	}

	async suppressForceScan(): Promise<void> {
		this.forceScanSuppressed = true;
	}

	async unsuppressForceScan(): Promise<void> {
		this.forceScanSuppressed = false;
	}

	async enableBackgroundMode(): Promise<void> {
		this.backgroundMode = true;
	}

	async disableBackgroundMode(): Promise<void> {
		this.backgroundMode = false;
		await Promise.all([...this.backgroundScanQueue].map(async (doc) => await this.scanDoc(doc)));
		this.backgroundScanQueue.clear();
	}

	async dispose(): Promise<void> {
		await this.janitor.dispose();
		await this.intervalMaid.dispose();
	}

	private async loadMemos(options?: { updateView?: boolean }): Promise<void> {
		await this.fetchDocs().then(async () => {
			await Promise.all([...this.watchedDocs.keys()].map(async (doc) => await this.scanDoc(doc)));
			if (options?.updateView) eventEmitter.emit("updateView");
		});
	}

	private async fetchDocs(): Promise<void> {
		const watch = await configMaid.get("fetcher.watch");
		const ignore = await configMaid.get("fetcher.ignore");
		const uUnfiltered = await workspace.findFiles(watch, ignore).then((files) =>
			files.map((file) =>
				workspace.openTextDocument(file).then(
					(doc) => <TextDocument>doc,
					() => <null>null,
				),
			),
		);
		const documents: TextDocument[] = (await Promise.all(uUnfiltered)).filter((doc) =>
			Object.hasOwn(LangCommentFormat, doc?.languageId),
		);
		commands.executeCommand("setContext", "better-memo.noFiles", documents.length === 0);
		this.watchedDocs.clear();
		for (const doc of documents) this.watchedDocs.set(doc, { version: doc.version, lang: doc.languageId });
		for (const doc of this.docMemos.keys()) if (!this.watchedDocs.has(doc)) this.docMemos.delete(doc);
		await Promise.all(
			[...this.watchedDocs.keys()].map(async (doc) => {
				if (!this.docMemos.has(doc)) return await this.scanDoc(doc);
			}),
		);
	}

	private async fetchCustomTags(): Promise<void> {
		const userDefinedCustomTags = await configMaid.get("general.customTags");
		const validTagRE = RegExp(`^[^\\r\\n\t ${commentCloseCharacters}]+$`);
		const validHexRE = /(?:^#?[0-9a-f]{6}$)|(?:^#?[0-9a-f]{3}$)/i;
		const validCustomTags: { [tag: string]: Promise<ThemeColor> } = {};
		for (let [tag, hex] of Object.entries(userDefinedCustomTags)) {
			[tag, hex] = [tag.trim().toUpperCase(), (<string>hex).trim()];
			if (!validTagRE.test(tag) || !validHexRE.test(<string>hex)) continue;
			validCustomTags[tag] = colorMaid.interpolate(<string>hex);
		}
		await Promise.all(Object.values(validCustomTags));
		this.customTags = validCustomTags;
	}

	private async scanDocInterval(): Promise<void> {
		const doc = window.activeTextEditor?.document;
		if (!doc) return;
		this.prevDoc = doc;
		if (await this.validateForScan(doc)) this.scanDoc(doc, { updateView: true });
	}

	private async forceScanInterval(): Promise<void> {
		if (this.forceScanSuppressed) return;
		const doc = window.activeTextEditor?.document;
		if (!doc || !this.watchedDocs.has(doc)) return;
		this.scanDoc(doc, { updateView: true });
	}

	private async formatMemos(doc: TextDocument): Promise<void> {
		const memos = this.docMemos.get(doc);
		if (!memos) return;
		const edit = new FEdit.FileEdit();
		for (const memo of memos)
			await edit.replace(
				doc.uri,
				[memo.offset, memo.offset + memo.rawLength],
				await MemoFetcher.getFormattedMemo(memo),
			);
		await edit.apply({ isRefactoring: true });
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
		if (await this.validateForScan(this.prevDoc)) await this.scanDoc(this.prevDoc, { updateView: true });
		this.formatMemos(this.prevDoc);
		if (!input) return;
		//@ts-ignore
		workspace.openTextDocument(input.uri).then(async (doc) => {
			this.prevDoc = doc;
		});
	}

	private async validateForScan(doc?: TextDocument): Promise<boolean> {
		const watched = this.watchedDocs.get(doc);
		if (!watched) return false;
		const versionChanged = doc.version !== watched.version;
		const langChanged = doc.languageId !== watched.lang;
		if (versionChanged) watched.version = doc.version;
		if (langChanged) watched.lang = doc.languageId;
		return versionChanged || langChanged;
	}
}
