import { commands, TabGroup, TextDocument, ThemeColor, Uri, window, workspace } from "vscode";
import { Aux } from "./utils/auxiliary";
import { Colors } from "./utils/colors";
import { FileEdit } from "./utils/file-edit";
import { Janitor, getJanitor } from "./utils/janitor";
import { ConfigMaid, getConfigMaid } from "./utils/config-maid";
import { IntervalMaid, getIntervalMaid } from "./utils/interval-maid";
import { EventEmitter, getEventEmitter } from "./utils/event-emitter";

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

export type MemoEngine = typeof memoEngine;

export async function getMemoEngine(): Promise<MemoEngine> {
	return memoEngine;
}

const memoEngine: {
	init(): Promise<void>;

	isDocWatched(docOrPath: TextDocument | string): Promise<boolean>;
	isMemoKnown(memo: MemoEntry): Promise<boolean>;

	getMemos(): Promise<MemoEntry[]>;
	getCustomTags(): Promise<{ [tag: string]: ThemeColor }>;
	getTags(): Promise<{ [tag: string]: ThemeColor }>;

	removeMemos(...memos: MemoEntry[]): Promise<void>;
	removeAllMemos(): Promise<void>;

	getFormattedMemo(memo: MemoEntry): Promise<string>;
	formatMemosInDoc(doc: TextDocument): Promise<void>;

	enterLazyMode(): Promise<void>;
	leaveLazyMode(): Promise<void>;

	getMemoMatchRE(doc: TextDocument): Promise<RegExp>;
	fetchMemos(options?: { updateView?: boolean }): Promise<void>;
	fetchDocs(): Promise<void>;
	scanDoc(doc: TextDocument, options?: { updateView?: boolean; ignoreLazyMode?: boolean }): Promise<void>;

	scanDocInterval(): Promise<void>;
	forceScanInterval(): Promise<void>;
	handleTabChange(changed: readonly TabGroup[]): Promise<void>;

	isDocValidForScan(doc?: TextDocument): Promise<boolean>;

	watchedDocsToInfoMap: Map<TextDocument, { version: number; lang: string }>;
	documentToMemosMap: Map<TextDocument, MemoEntry[]>;

	customTagsToColor: { [tag: string]: ThemeColor };
	customTagsChanged: boolean;

	inLazyMode: boolean;
	lazyModeScanStack: Set<TextDocument>;

	previousFocusedDocument?: TextDocument;

	commentCloseCharacters?: string;
	janitor?: Janitor;
	configMaid?: ConfigMaid;
	intervalMaid?: IntervalMaid;
	eventEmitter?: EventEmitter;
} = {
	watchedDocsToInfoMap: new Map(),
	documentToMemosMap: new Map(),

	customTagsToColor: {},
	customTagsChanged: true,

	inLazyMode: false,
	lazyModeScanStack: new Set(),

	async init(): Promise<void> {
		const tmp = (
			await Aux.async.map(
				Object.values(LangCommentFormat).flat(),
				async (format) => (<{ open: string; close?: string }>format).close,
			)
		)
			.join("")
			.split("");
		memoEngine.commentCloseCharacters = await Aux.re.escape([...new Set(tmp)].join(""));

		memoEngine.janitor = await getJanitor();
		memoEngine.configMaid = await getConfigMaid();
		memoEngine.intervalMaid = await getIntervalMaid();
		memoEngine.eventEmitter = await getEventEmitter();

		await Aux.promise.all(
			memoEngine.configMaid.listen("general.customTags"),
			memoEngine.configMaid.listen({
				"fetcher.watch": async (watch: string[]) => `{${watch.join(",")}}`,
				"fetcher.ignore": async (ignore: string[]) => `{${ignore.join(",")}}`,
			}),
			memoEngine.configMaid.listen("fetcher.lazyModeLineBufferMax"),
		);

		await memoEngine.configMaid.onChange("general.customTags", async () => {
			memoEngine.customTagsChanged = true;
			memoEngine.eventEmitter.emit("updateView");
		}),
			await Aux.promise.all(
				memoEngine.intervalMaid.add(async () => await memoEngine.scanDocInterval(), "fetcher.scanDelay"),
				memoEngine.intervalMaid.add(async () => await memoEngine.forceScanInterval(), "fetcher.forceScanDelay"),
				memoEngine.intervalMaid.add(async () => await memoEngine.fetchDocs(), "fetcher.workspaceScanDelay"),
			);

		await memoEngine.janitor.add(
			workspace.onDidCreateFiles(async () => await memoEngine.fetchDocs()),
			workspace.onDidDeleteFiles(async () => await memoEngine.fetchDocs()),

			workspace.onDidSaveTextDocument(async (doc) => {
				if (await memoEngine.isDocValidForScan(doc)) memoEngine.scanDoc(doc, { updateView: true });
			}),
			window.tabGroups.onDidChangeTabGroups(async (ev) => await memoEngine.handleTabChange(ev.changed)),

			commands.registerCommand(
				"better-memo.reloadExplorer",
				async () => await memoEngine.fetchMemos({ updateView: true }),
			),
		);

		await memoEngine.fetchMemos();

		memoEngine.eventEmitter.emitWait("initViewProvider");
		memoEngine.eventEmitter.emitWait("initEditorCommands");
	},

	async isDocWatched(docOrPath: TextDocument | string): Promise<boolean> {
		try {
			const doc = typeof docOrPath === "string" ? await workspace.openTextDocument(docOrPath) : docOrPath;
			return memoEngine.watchedDocsToInfoMap.has(doc);
		} catch {
			return false;
		}
	},

	async isMemoKnown(memo: MemoEntry): Promise<boolean> {
		return await Aux.object.includes(await memoEngine.getMemos(), memo);
	},

	async getMemos(): Promise<MemoEntry[]> {
		const memos = [...memoEngine.documentToMemosMap.values()].flat();
		await commands.executeCommand("setContext", "better-memo.noMemos", memos.length === 0);
		return memos;
	},

	async getCustomTags(): Promise<{ [tag: string]: ThemeColor }> {
		const customTags: { [tag: string]: string } = await memoEngine.configMaid.get("general.customTags");
		const validTagRE = RegExp(`^[^\\r\\n\t ${memoEngine.commentCloseCharacters}]+$`);
		const validHexRE = /(?:^#?[0-9a-f]{6}$)|(?:^#?[0-9a-f]{3}$)/i;
		const uValidCustomTags: { [tag: string]: Promise<ThemeColor> } = {};
		await Aux.async.map(Object.entries(customTags), async ([tag, hex]) => {
			[tag, hex] = [tag.trim().toUpperCase(), hex.trim()];
			if (!validTagRE.test(tag) || !validHexRE.test(hex)) return;
			uValidCustomTags[tag] = Colors.interpolate(hex);
		});
		return await Aux.promise.props(uValidCustomTags);
	},

	async getTags(): Promise<{ [tag: string]: ThemeColor }> {
		const tags = await Aux.async.map(await memoEngine.getMemos(), async (memo: MemoEntry) => memo.tag);
		if (memoEngine.customTagsChanged) {
			memoEngine.customTagsChanged = false;
			memoEngine.customTagsToColor = await memoEngine.getCustomTags();
		}
		const uMemoTags = {};
		await Aux.async.map(tags, async (tag) => {
			if (!memoEngine.customTagsToColor[tag]) uMemoTags[tag] = Colors.hashColor(tag);
		});
		return Object.assign(await Aux.promise.props(uMemoTags), memoEngine.customTagsToColor);
	},

	async removeMemos(...memos: MemoEntry[]): Promise<void> {
		const removeMemo = async (memo: MemoEntry) =>
			await Aux.async.map(memoEngine.documentToMemosMap.entries(), async ([doc, memos]) => {
				if (!(await Aux.object.includes(memos, memo))) return;
				const memoIndex = await Aux.object.indexOf(memos, memo);
				const removed = memos.filter((_, i) => i !== memoIndex);
				memoEngine.documentToMemosMap.set(doc, removed);
			});
		await Aux.async.map(memos, async (memo) => await removeMemo(memo));
	},

	async removeAllMemos(): Promise<void> {
		memoEngine.documentToMemosMap.clear();
	},

	async getFormattedMemo(memo: MemoEntry): Promise<string> {
		const commentFormat: { open: string; close?: string } = [LangCommentFormat[memo.langId]].flat()[0];
		const padding = commentFormat.close ? " " : "";
		return `${commentFormat.open}${padding}MO ${memo.tag}${memo.content ? " " : ""}${"!".repeat(memo.priority)}${
			memo.content
		}${padding}${commentFormat.close ?? ""}`;
	},

	async formatMemosInDoc(doc: TextDocument): Promise<void> {
		await memoEngine.scanDoc(doc, { ignoreLazyMode: true });
		const memos = memoEngine.documentToMemosMap.get(doc);
		if (memos.length === 0) return;

		const formatMemo = async (memo: MemoEntry) =>
			await edit.replace(
				doc.uri,
				[memo.offset, memo.offset + memo.rawLength],
				await memoEngine.getFormattedMemo(memo),
			);

		const edit = new FileEdit();
		await Aux.async.map(memos, async (memo: MemoEntry) => await formatMemo(memo));
		await edit.apply({ isRefactoring: true });
	},

	async enterLazyMode(): Promise<void> {
		memoEngine.inLazyMode = true;
	},

	async leaveLazyMode(): Promise<void> {
		memoEngine.inLazyMode = false;
		memoEngine.lazyModeScanStack.clear();
		await Aux.async.map(memoEngine.lazyModeScanStack, async (doc) => await memoEngine.scanDoc(doc));
		await memoEngine.eventEmitter.emit("updateView");
	},

	async fetchMemos(options?: { updateView?: boolean }): Promise<void> {
		await memoEngine.fetchDocs();
		await Aux.async.map(memoEngine.watchedDocsToInfoMap.keys(), async (doc) => await memoEngine.scanDoc(doc));
		if (options?.updateView) await memoEngine.eventEmitter.emit("updateView");
	},

	async fetchDocs(): Promise<void> {
		const watch = await memoEngine.configMaid.get("fetcher.watch");
		const ignore = await memoEngine.configMaid.get("fetcher.ignore");

		const getDoc = async (uri: Uri) => {
			try {
				return await workspace.openTextDocument(uri);
			} finally {
			}
		};
		const unfilteredUris = await workspace.findFiles(watch, ignore);
		const unfilteredDocs = await Aux.async.map(unfilteredUris, async (uri) => await getDoc(uri));
		const docs: TextDocument[] = unfilteredDocs.filter((doc) => Object.hasOwn(LangCommentFormat, doc?.languageId));
		await commands.executeCommand("setContext", "better-memo.noFiles", docs.length === 0);

		memoEngine.watchedDocsToInfoMap.clear();
		await Aux.promise.all(
			Aux.async.map(docs, async (doc) =>
				memoEngine.watchedDocsToInfoMap.set(doc, { version: doc.version, lang: doc.languageId }),
			),
			Aux.async.map(memoEngine.documentToMemosMap.keys(), async (doc) => {
				if (!(await memoEngine.isDocWatched(doc))) memoEngine.documentToMemosMap.delete(doc);
			}),
			Aux.async.map(memoEngine.watchedDocsToInfoMap.keys(), async (doc) => {
				if (!(await memoEngine.isDocWatched(doc))) memoEngine.scanDoc(doc);
			}),
		);
	},

	async getMemoMatchRE(doc: TextDocument): Promise<RegExp> {
		const langId = <keyof typeof LangCommentFormat>doc.languageId;
		const commentFormats: { open: string; close?: string }[] = [LangCommentFormat[langId]].flat();
		const commentFormatREs = await Aux.async.map(commentFormats, async (data, i) => {
			const open = await Aux.re.escape(data.open);
			const close = await Aux.re.escape(data.close ?? "");
			return `(?<![${open}])${open}[\\t ]*mo[\\t ]+(?<tag${i}>[^\\r\\n\\t ${
				memoEngine.commentCloseCharacters
			}]+)[\\t ]*(?<priority${i}>!*)(?<content${i}>.*${close ? "?" : ""})${close}`;
		});
		const matchPatternRaw = await Aux.re.union(...commentFormatREs);
		return RegExp(matchPatternRaw, "gim");
	},

	async scanDoc(doc: TextDocument, options?: { updateView?: boolean; ignoreLazyMode?: boolean }): Promise<void> {
		if (memoEngine.inLazyMode && !options?.ignoreLazyMode) {
			memoEngine.lazyModeScanStack.add(doc);
			const bufferDocs = [...memoEngine.lazyModeScanStack.values()];
			const bufferLines = await Aux.async.map(bufferDocs, async (doc) => doc.lineCount);
			const backgroundModeScanBuffer = await Aux.math.sum(...bufferLines);
			const lazyModeLineBufferMax = await memoEngine.configMaid.get("fetcher.lazyModeLineBufferMax");
			if (backgroundModeScanBuffer < lazyModeLineBufferMax) return;
			memoEngine.lazyModeScanStack.delete(doc);
		}

		const docContent = doc.getText();
		const matchPattern = await memoEngine.getMemoMatchRE(doc);

		let memos = [];
		await Aux.async.map(docContent.matchAll(matchPattern), async (match) => {
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
				langId: doc.languageId,
				raw: match[0],
				rawLength: match[0].length,
			});
		});
		memoEngine.documentToMemosMap.set(doc, memos);
		if (options?.updateView) await memoEngine.eventEmitter.emit("updateView");
	},

	async scanDocInterval(): Promise<void> {
		const doc = window.activeTextEditor?.document;
		if (!doc) return;
		memoEngine.previousFocusedDocument = doc;
		if (await memoEngine.isDocValidForScan(doc)) memoEngine.scanDoc(doc, { updateView: true });
	},

	async forceScanInterval(): Promise<void> {
		const doc = window.activeTextEditor?.document;
		if (!doc || !memoEngine.watchedDocsToInfoMap.has(doc)) return;
		memoEngine.scanDoc(doc, { updateView: true });
	},

	async handleTabChange(changed: readonly TabGroup[]): Promise<void> {
		if (
			!memoEngine.previousFocusedDocument ||
			!memoEngine.watchedDocsToInfoMap.has(memoEngine.previousFocusedDocument) ||
			changed.length !== 1
		)
			return;
		const tabGroup = changed[0];
		const activeTab = tabGroup.activeTab;
		const input: { uri?: Uri } = activeTab?.input;
		if (
			!tabGroup.isActive ||
			(activeTab && !activeTab?.isActive) ||
			(input && !(await memoEngine.isDocWatched(input.uri?.path)))
		)
			return;
		if (memoEngine.previousFocusedDocument.isDirty) return;
		memoEngine.formatMemosInDoc(memoEngine.previousFocusedDocument);
		if (!input) return;
		const doc = await workspace.openTextDocument(input.uri);
		memoEngine.previousFocusedDocument = doc;
	},

	async isDocValidForScan(doc?: TextDocument): Promise<boolean> {
		const docInfo = memoEngine.watchedDocsToInfoMap.get(doc);
		if (!docInfo) return false;
		const versionChanged = doc.version !== docInfo.version;
		const langChanged = doc.languageId !== docInfo.lang;
		if (versionChanged) docInfo.version = doc.version;
		if (langChanged) docInfo.lang = doc.languageId;
		return versionChanged || langChanged;
	},
};
