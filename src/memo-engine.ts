import { commands, TabGroupChangeEvent, TextDocument, ThemeColor, Uri, window, workspace } from "vscode";
import { Aux } from "./utils/auxiliary";
import { ConfigMaid } from "./utils/config-maid";
import { FileEdit } from "./utils/file-edit";
import { Janitor } from "./utils/janitor";
import { VSColors } from "./utils/vs-colors";
import { ExplorerView } from "./explorer-view";

import LangCommentFormat from "./json/comment-format.json";

export namespace MemoEngine {
	const langCommentFormat: {
		[lang: string]: { open: string; close?: string } | { open: string; close?: string }[];
	} = LangCommentFormat;

	export type MemoEntry = {
		readonly content: string;
		readonly tag: string;
		readonly priority: number;
		readonly line: number;
		readonly offset: number;
		readonly path: string;
		readonly relativePath: string;
		readonly langId: keyof typeof langCommentFormat;
		readonly raw: string;
		readonly rawLength: number;
	};

	const dupCloseChars = Object.values(langCommentFormat)
		.flat()
		.map((format) => format.close)
		.join("")
		.split("");
	const commentCloseChars = Aux.re.escape([...new Set(dupCloseChars)].join(""));

	const validTagRE = RegExp(`^[^\\r\\n\t ${commentCloseChars}]+$`);
	const validHexRE = /(?:^#?[0-9a-f]{6}$)|(?:^#?[0-9a-f]{3}$)/i;

	const watchedDocInfoMap: Map<TextDocument, { version: number; lang: string }> = new Map();
	const docMemosMap: Map<TextDocument, MemoEntry[]> = new Map();

	let customTagColors: { [tag: string]: ThemeColor } = {};
	let customTagsChanged = true;

	let prevFocusTab: string | undefined;

	let inLazyMode = false;
	const lazyModeScanStack: Set<TextDocument> = new Set();

	export async function initEngine(): Promise<void> {
		ConfigMaid.listen("general.customTags");
		ConfigMaid.listen({
			"fetcher.watch": (watch: string[]) => `{${watch.join(",")}}`,
			"fetcher.ignore": (ignore: string[]) => `{${ignore.join(",")}}`,
		});
		ConfigMaid.listen("fetcher.lazyModeLineBufferMax");

		ConfigMaid.onChange("general.customTags", () => {
			customTagsChanged = true;
			ExplorerView.updateView();
		});

		ConfigMaid.newInterval(scanInterval, "fetcher.scanDelay");
		ConfigMaid.newInterval(forceScanInterval, "fetcher.forceScanDelay");
		ConfigMaid.newInterval(fetchDocs, "fetcher.workspaceScanDelay");

		Janitor.add(
			workspace.onDidCreateFiles(fetchDocs),
			workspace.onDidDeleteFiles(fetchDocs),

			workspace.onDidSaveTextDocument((doc) => {
				if (validateForScan(doc)) scanDoc(doc, { updateView: true });
			}),
			window.tabGroups.onDidChangeTabGroups(onTabChange),

			commands.registerCommand("better-memo.reloadExplorer", () => fetchMemos({ updateView: true })),
		);

		await fetchMemos();
	}

	export function isDocWatched(doc: TextDocument): boolean {
		return watchedDocInfoMap.has(doc);
	}

	export function isMemoKnown(memo: MemoEntry): boolean {
		return Aux.object.includes(getMemos(), memo);
	}

	export function getMemos(): MemoEntry[] {
		const memos = [...docMemosMap.values()].flat();
		commands.executeCommand("setContext", "better-memo.noMemos", memos.length === 0);
		return memos;
	}

	export function getMemosInDoc(doc: TextDocument): MemoEntry[] {
		return docMemosMap.get(doc);
	}

	export function getMemosWithTag(tag: string): MemoEntry[] {
		const memos = getMemos();
		return memos.filter((memo) => memo.tag === tag);
	}

	export async function getTagColors(): Promise<{ [tag: string]: ThemeColor }> {
		const tags = getMemos().map((memo) => memo.tag);
		if (customTagsChanged) {
			customTagColors = await fetchCustomTagColors();
			customTagsChanged = false;
		}
		const tagColors = customTagColors;
		await Aux.async.map(tags, async (tag) => {
			if (!tagColors[tag]) tagColors[tag] = VSColors.hashColor(tag);
		});
		return tagColors;
	}

	export function forgetMemos(...memos: MemoEntry[]): void {
		for (const [doc, docMemos] of docMemosMap.entries()) {
			const removed = docMemos.filter((memo) => !Aux.object.includes(memos, memo));
			docMemosMap.set(doc, removed);
		}
		getMemos();
	}

	export function forgetAllMemos(): void {
		docMemosMap.clear();
		commands.executeCommand("setContext", "better-memo.noMemos", true);
	}

	export function enterLazyMode(): void {
		inLazyMode = true;
		lazyModeScanStack.clear();
	}

	export function leaveLazyMode(): void {
		inLazyMode = false;
		for (const doc of lazyModeScanStack) scanDoc(doc);
		lazyModeScanStack.clear();
		ExplorerView.updateView();
	}

	export async function scanDoc(
		doc: TextDocument,
		options?: { updateView?: boolean; ignoreLazyMode?: boolean },
	): Promise<void> {
		if (inLazyMode && !options?.ignoreLazyMode) {
			lazyModeScanStack.add(doc);
			const bufferDocs = [...lazyModeScanStack.values()];
			const bufferLines = bufferDocs.map((doc) => doc.lineCount);
			const backgroundModeScanBuffer = Aux.math.sum(...bufferLines);
			if (backgroundModeScanBuffer < ConfigMaid.get("fetcher.lazyModeLineBufferMax")) return;

			lazyModeScanStack.delete(doc);
		}

		const docContent = doc.getText();
		const matchRE = getMemoMatchRE(doc);

		let memos: MemoEntry[] = [];
		await Aux.async.map(docContent.matchAll(matchRE), async (match) => {
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

		docMemosMap.set(doc, memos);
		if (options?.updateView) ExplorerView.updateView();
	}

	async function fetchDocs(): Promise<void> {
		const watch = ConfigMaid.get("fetcher.watch");
		const ignore = ConfigMaid.get("fetcher.ignore");

		const getDoc = async (uri: Uri) => {
			try {
				return await workspace.openTextDocument(uri);
			} finally {
			}
		};
		const fileUris = await workspace.findFiles(watch, ignore);
		const files = await Aux.async.map(fileUris, async (uri) => await getDoc(uri));
		commands.executeCommand("setContext", "better-memo.noFiles", files.length === 0);
		const docs = files.filter((doc) => langCommentFormat[doc?.languageId]);

		watchedDocInfoMap.clear();
		for (const doc of docs) watchedDocInfoMap.set(doc, { version: doc.version, lang: doc.languageId });
		for (const doc of docMemosMap.keys()) if (!isDocWatched(doc)) docMemosMap.delete(doc);
		for (const doc of watchedDocInfoMap.keys()) if (!isDocWatched(doc)) scanDoc(doc);
	}

	async function fetchMemos(options?: { updateView?: boolean }): Promise<void> {
		await fetchDocs();
		await Aux.async.map(watchedDocInfoMap.keys(), async (doc) => await scanDoc(doc));
		if (options?.updateView) ExplorerView.updateView();
	}

	function getMemoMatchRE(doc: TextDocument): RegExp {
		const commentFormats = [langCommentFormat[doc.languageId]].flat();
		const commentFormatREs = commentFormats.map((data, i) => {
			const open = Aux.re.escape(data.open);
			const close = Aux.re.escape(data.close ?? "");
			return `(?<![${open}])${open}[\\t ]*mo[\\t ]+(?<tag${i}>[^\\r\\n\\t ${commentCloseChars}]+)[\\t ]*(?<priority${i}>!*)(?<content${i}>.*${
				close ? "?" : ""
			})${close}`;
		});
		const matchPattern = Aux.re.union(...commentFormatREs);
		return RegExp(matchPattern, "gim");
	}

	function validateForScan(doc?: TextDocument): boolean {
		const docInfo = watchedDocInfoMap.get(doc);
		if (!docInfo) return false;
		const versionChanged = doc.version !== docInfo.version;
		const langChanged = doc.languageId !== docInfo.lang;
		if (versionChanged) docInfo.version = doc.version;
		if (langChanged) docInfo.lang = doc.languageId;
		return versionChanged || langChanged;
	}

	function scanInterval(): void {
		const doc = window.activeTextEditor?.document;
		if (doc && validateForScan(doc)) scanDoc(doc, { updateView: true });
	}

	function forceScanInterval(): void {
		const doc = window.activeTextEditor?.document;
		if (!doc || !isDocWatched(doc)) return;
		scanDoc(doc, { updateView: true });
	}

	async function onTabChange(ev: TabGroupChangeEvent): Promise<void> {
		for (const changedTab of ev.changed) {
			if (!changedTab.isActive) continue;
			const activeTab = changedTab.activeTab;
			if (!activeTab) {
				prevFocusTab = undefined;
				break;
			}
			if (!activeTab.isActive || activeTab.label === prevFocusTab) continue;

			let doc;
			try {
				doc = await workspace.openTextDocument((<{ uri?: Uri }>activeTab.input).uri);
			} catch {
				continue;
			}
			if (!isDocWatched(doc)) continue;

			prevFocusTab = activeTab.label;
			await formatMemosInDoc(doc);
			break;
		}
	}

	async function fetchCustomTagColors(): Promise<{ [tag: string]: ThemeColor }> {
		const customTags: { [tag: string]: string } = ConfigMaid.get("general.customTags");
		const validCustomTags: { [tag: string]: ThemeColor } = {};
		await Aux.async.map(Object.entries(customTags), async ([tag, hex]) => {
			[tag, hex] = [tag.trim().toUpperCase(), hex.trim()];
			if (!validTagRE.test(tag) || !validHexRE.test(hex)) return;
			validCustomTags[tag] = VSColors.interpolate(hex);
		});
		return validCustomTags;
	}

	function getFormattedMemo(memo: MemoEntry): string {
		const commentFormat = [langCommentFormat[memo.langId]].flat()[0];
		const padding = commentFormat.close ? " " : "";
		return `${commentFormat.open}${padding}MO ${memo.tag}${memo.content ? " " : ""}${"!".repeat(memo.priority)}${
			memo.content
		}${padding}${commentFormat.close ?? ""}`;
	}

	async function formatMemosInDoc(doc: TextDocument): Promise<void> {
		await scanDoc(doc, { ignoreLazyMode: true });
		const memos = getMemosInDoc(doc);
		if (memos.length === 0) return;

		const edit = new FileEdit.Edit();
		for (const memo of memos)
			edit.replace(doc.uri, [memo.offset, memo.offset + memo.rawLength], getFormattedMemo(memo));
		await edit.apply();
	}
}
