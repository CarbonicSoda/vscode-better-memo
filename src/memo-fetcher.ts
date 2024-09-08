import { commands, TabGroup, TextDocument, ThemeColor, Uri, window, workspace } from "vscode";
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

export type MemoFetcher = typeof memoFetcher;

export async function getMemoFetcher(): Promise<typeof memoFetcher> {
	return memoFetcher;
}

const memoFetcher: {
	init(): Promise<void>;
	dispose(): Promise<void>;

	watches(path: string): Promise<boolean>;
	includes(memo: MemoEntry): Promise<boolean>;

	getMemos(): Promise<MemoEntry[]>;
	getMemosInDoc(doc: TextDocument): Promise<MemoEntry[]>;
	fetchCustomTags(): Promise<{ [tag: string]: ThemeColor }>;
	getTags(): Promise<{ [tag: string]: ThemeColor }>;

	removeMemo(memo: MemoEntry): Promise<void>;
	removeMemos(...memos: MemoEntry[]): Promise<void>;
	removeAllMemos(): Promise<void>;

	fetchDocs(): Promise<void>;
	scanDoc(doc: TextDocument, options?: { updateView?: boolean }): Promise<void>;
	fetchMemos(options?: { updateView?: boolean }): Promise<void>;

	getFormattedMemo(memo: MemoEntry): Promise<string>;
	formatMemos(doc: TextDocument): Promise<void>;

	suppressForceScan(): Promise<void>;
	unsuppressForceScan(): Promise<void>;

	enableBackgroundMode(): Promise<void>;
	disableBackgroundMode(): Promise<void>;

	scanDocInterval(): Promise<void>;
	forceScanInterval(): Promise<void>;
	onTabChange(changed: readonly TabGroup[]): Promise<void>;

	validateForScan(doc?: TextDocument): Promise<boolean>;

	watchedDocsToInfoMap: Map<TextDocument, { version: number; lang: string }>;
	documentToMemosMap: Map<TextDocument, MemoEntry[]>;

	customTagsToColor: { [tag: string]: ThemeColor };
	customTagsChanged: boolean;

	forceScanSuppressed: boolean;

	backgroundMode: boolean;
	backgroundScanQueue: Set<TextDocument>;
	backgroundScanBuffer: number;
	backgroundScanBufferMax: number;

	janitor: Janitor;
	intervalMaid: IntervalMaid;

	previousFocusedDocument?: TextDocument;
} = {
	async init(): Promise<void> {
		if (!resolved) throw moduleUnresolvedError;

		await this.fetchMemos();

		await this.janitor.add(
			workspace.onDidCreateFiles(async () => await this.fetchDocs()),
			workspace.onDidDeleteFiles(async () => await this.fetchDocs()),

			workspace.onDidSaveTextDocument(async (doc) => {
				if (this.validateForScan(doc)) this.scanDoc(doc, { updateView: true });
			}),
			window.tabGroups.onDidChangeTabGroups(async (ev) => await this.onTabChange(ev.changed)),

			configMaid.onChange("general.customTags", async () => {
				this.customTagsChanged = true;
				eventEmitter.emit("updateView");
			}),

			commands.registerCommand(
				"better-memo.reloadExplorer",
				async () => await this.fetchMemos({ updateView: true }),
			),
		);

		await Promise.all([
			this.intervalMaid.add(async () => await this.scanDocInterval(), "fetcher.scanDelay", 100, 1000000),
			this.intervalMaid.add(async () => await this.forceScanInterval(), "fetcher.forceScanDelay", 500, 5000000),
			this.intervalMaid.add(async () => await this.fetchDocs(), "fetcher.workspaceScanDelay", 1000, 10000000),
		]);

		eventEmitter.emitWait("initExplorerView");
		eventEmitter.emitWait("initTextEditorCommands");
	},

	async dispose(): Promise<void> {
		await this.janitor.dispose();
		await this.intervalMaid.dispose();
	},

	async watches(docOrPath: TextDocument | string): Promise<boolean> {
		const doc = typeof docOrPath === "string" ? await workspace.openTextDocument(docOrPath) : docOrPath;
		return this.watchedDocsToInfoMap.has(doc);
	},

	async includes(memo: MemoEntry): Promise<boolean> {
		return await Aux.objectsInclude(this.documentToMemosMap.values(), memo);
	},

	async getMemos(): Promise<MemoEntry[]> {
		const memos = [...this.documentToMemosMap.values()].flat();
		await commands.executeCommand("setContext", "better-memo.noMemos", memos.length === 0);
		return memos;
	},

	async getMemosInDoc(doc: TextDocument): Promise<MemoEntry[]> {
		return this.documentToMemosMap.get(doc);
	},

	async fetchCustomTags(): Promise<{ [tag: string]: ThemeColor }> {
		const customTags = await configMaid.get("general.customTags");
		const validTagRE = RegExp(`^[^\\r\\n\t ${commentCloseCharacters}]+$`);
		const validHexRE = /(?:^#?[0-9a-f]{6}$)|(?:^#?[0-9a-f]{3}$)/i;
		const uValidCustomTags: { [tag: string]: Promise<ThemeColor> } = {};
		await Aux.asyncFor(Object.entries(customTags), async ([tag, hex]) => {
			[tag, hex] = [tag.trim().toUpperCase(), (<string>hex).trim()];
			if (!validTagRE.test(tag) || !validHexRE.test(<string>hex)) return;
			uValidCustomTags[tag] = colorMaid.interpolate(<string>hex);
		});
		return await Aux.promiseProps(uValidCustomTags);
	},

	async getTags(): Promise<{ [tag: string]: ThemeColor }> {
		const tags = await Aux.asyncFor(await this.getMemos(), async (memo: MemoEntry) => memo.tag);
		if (this.customTagsChanged) {
			this.customTagsChanged = false;
			this.customTagsToColor = await this.fetchCustomTags();
		}
		const uMemoTags = {};
		await Aux.asyncFor(tags, async (tag) => {
			if (!this.customTagsToColor[tag]) uMemoTags[tag] = colorMaid.hashColor(tag);
		});
		return Object.assign(await Aux.promiseProps(uMemoTags), this.customTagsToColor);
	},

	async removeMemo(memo: MemoEntry): Promise<void> {
		await Aux.asyncFor(
			(<Map<TextDocument, MemoEntry[]>>this.documentToMemosMap).entries(),
			async ([doc, memos]) => {
				if (!(await Aux.objectsInclude(memos, memo))) return;
				const memoIndex = await Aux.objectsIndexOf(memos, memo);
				const removed = (<MemoEntry[]>memos).filter((_, i) => i !== memoIndex);
				this.documentToMemosMap.set(doc, removed);
			},
		);
	},

	async removeMemos(...memos: MemoEntry[]): Promise<void> {
		await Aux.asyncFor(memos, async (memo) => await this.removeMemo(memo));
	},

	async removeAllMemos(): Promise<void> {
		this.documentToMemosMap.clear();
	},

	async fetchDocs(): Promise<void> {
		const watch = await configMaid.get("fetcher.watch");
		const ignore = await configMaid.get("fetcher.ignore");

		const getDoc = async (uri: Uri) => {
			try {
				return await workspace.openTextDocument(uri);
			} finally {
			}
		};
		const unfilteredUris = await workspace.findFiles(watch, ignore);
		const unfilteredDocs = await Aux.asyncFor(unfilteredUris, async (uri) => await getDoc(uri));
		const docs: TextDocument[] = unfilteredDocs.filter((doc) => Object.hasOwn(LangCommentFormat, doc?.languageId));

		this.watchedDocsToInfoMap.clear();
		await commands.executeCommand("setContext", "better-memo.noFiles", docs.length === 0);

		await Promise.all([
			Aux.asyncFor(
				docs,
				async (doc) => await this.watchedDocsToInfoMap.set(doc, { version: doc.version, lang: doc.languageId }),
			),
			Aux.asyncFor(this.documentToMemosMap.keys(), async (doc) => {
				if (!this.watchedDocsToInfoMap.has(doc)) this.documentToMemosMap.delete(doc);
			}),
			Aux.asyncFor(this.watchedDocsToInfoMap.keys(), async (doc) => {
				if (!this.documentToMemosMap.has(doc)) this.scanDoc(doc);
			}),
		]);
	},

	async scanDoc(doc: TextDocument, options?: { updateView?: boolean }): Promise<void> {
		if (this.backgroundMode) {
			if (this.backgroundScanBuffer < this.backgroundScanBufferMax) {
				this.backgroundScanBuffer += doc.lineCount;
				this.backgroundScanQueue.add(doc);
				return;
			} else {
				this.backgroundScanBuffer -= doc.lineCount;
			}
		}

		const docContent = doc.getText();
		const langId = <keyof typeof LangCommentFormat>doc.languageId;
		const commentFormats: { open: string; close?: string }[] = [LangCommentFormat[langId]].flat();
		const commentFormatREs = await Aux.asyncFor(commentFormats, async (data, i) => {
			const open = await Aux.reEscape(data.open);
			const close = await Aux.reEscape(data.close ?? "");
			return `(?<![${open}])${open}[\\t ]*mo[\\t ]+(?<tag${i}>[^\\r\\n\\t ${commentCloseCharacters}]+)[\\t ]*(?<priority${i}>!*)(?<content${i}>.*${
				close ? "?" : ""
			})${close}`;
		});
		const matchPatternRaw = `(?:${commentFormatREs.join(")|(?:")})`;
		const matchPattern = RegExp(matchPatternRaw, "gim");

		let memos = [];
		await Aux.asyncFor(docContent.matchAll(matchPattern), async (match) => {
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
				line: doc.positionAt(match.index).line,
				offset: match.index,
				path: doc.fileName,
				relativePath: workspace.asRelativePath(doc.fileName),
				langId: langId,
				raw: match[0],
				rawLength: match[0].length,
			});
		});
		this.documentToMemosMap.set(doc, memos);
		if (options?.updateView) await eventEmitter.emit("updateView");
	},

	async fetchMemos(options?: { updateView?: boolean }): Promise<void> {
		await this.fetchDocs();
		await Aux.asyncFor(this.watchedDocsToInfoMap.keys(), async (doc) => await this.scanDoc(doc));
		if (options?.updateView) await eventEmitter.emit("updateView");
	},

	async getFormattedMemo(memo: MemoEntry): Promise<string> {
		const commentFormat: { open: string; close?: string } = [LangCommentFormat[memo.langId]].flat()[0];
		const padding = commentFormat.close ? " " : "";
		return `${commentFormat.open}${padding}MO ${memo.tag}${memo.content ? " " : ""}${"!".repeat(memo.priority)}${
			memo.content
		}${padding}${commentFormat.close ?? ""}`;
	},

	async formatMemos(doc: TextDocument): Promise<void> {
		const memos = this.documentToMemosMap.get(doc);
		if (!memos) return;

		const formatMemo = async (memo: MemoEntry) =>
			await edit.replace(doc.uri, [memo.offset, memo.offset + memo.rawLength], await this.getFormattedMemo(memo));

		const edit = new FEdit.FileEdit();
		await Aux.asyncFor(memos, async (memo: MemoEntry) => await formatMemo(memo));
		await edit.apply({ isRefactoring: true });
	},

	async suppressForceScan(): Promise<void> {
		this.forceScanSuppressed = true;
	},

	async unsuppressForceScan(): Promise<void> {
		this.forceScanSuppressed = false;
	},

	async enableBackgroundMode(): Promise<void> {
		this.backgroundMode = true;
	},

	async disableBackgroundMode(): Promise<void> {
		this.backgroundMode = false;
		await Aux.asyncFor(this.backgroundScanQueue, async (doc) => await this.scanDoc(doc));
		this.backgroundScanQueue.clear();
		this.backgroundScanBuffer = 0;
		await eventEmitter.emit("updateView");
	},

	async scanDocInterval(): Promise<void> {
		const doc = window.activeTextEditor?.document;
		if (!doc) return;
		this.previousFocusedDocument = doc;
		if (await this.validateForScan(doc)) this.scanDoc(doc, { updateView: true });
	},

	async forceScanInterval(): Promise<void> {
		if (this.forceScanSuppressed) return;
		const doc = window.activeTextEditor?.document;
		if (!doc || !this.watchedDocsToInfoMap.has(doc)) return;
		this.scanDoc(doc, { updateView: true });
	},

	async onTabChange(changed: readonly TabGroup[]): Promise<void> {
		if (
			!this.previousFocusedDocument ||
			!this.watchedDocsToInfoMap.has(this.previousFocusedDocument) ||
			changed.length !== 1
		)
			return;
		const tabGroup = changed[0];
		const activeTab = tabGroup.activeTab;
		const input: { uri?: Uri } = activeTab?.input;
		if (
			!tabGroup.isActive ||
			(activeTab && !activeTab?.isActive) ||
			(input && !(await this.watches(input.uri?.path)))
		)
			return;
		if (this.previousFocusedDocument.isDirty) return;
		if (await this.validateForScan(this.previousFocusedDocument))
			await this.scanDoc(this.previousFocusedDocument, { updateView: true });
		this.formatMemos(this.previousFocusedDocument);
		if (!input) return;
		const doc = await workspace.openTextDocument(input.uri);
		this.previousFocusedDocument = doc;
	},

	async validateForScan(doc?: TextDocument): Promise<boolean> {
		const docInfo = this.watchedDocsToInfoMap.get(doc);
		if (!docInfo) return false;
		const versionChanged = doc.version !== docInfo.version;
		const langChanged = doc.languageId !== docInfo.lang;
		if (versionChanged) docInfo.version = doc.version;
		if (langChanged) docInfo.lang = doc.languageId;
		return versionChanged || langChanged;
	},

	watchedDocsToInfoMap: new Map(),
	documentToMemosMap: new Map(),

	customTagsToColor: {},
	customTagsChanged: true,

	forceScanSuppressed: false,

	backgroundMode: false,
	backgroundScanQueue: new Set(),
	backgroundScanBuffer: 0,
	backgroundScanBufferMax: 1000,

	janitor: new Janitor(),
	intervalMaid: new IntervalMaid(),
};

let resolved = false;
const moduleUnresolvedError = new Error("memo-fetcher is not resolved");
export async function resolver(): Promise<void> {
	if (resolved) return;
	resolved = true;

	const tmp = (
		await Aux.asyncFor(
			Object.values(LangCommentFormat).flat(),
			async (format) => (<{ open: string; close?: string }>format).close,
		)
	)
		.join("")
		.split("");
	commentCloseCharacters = await Aux.reEscape([...new Set(tmp)].join(""));

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
}
