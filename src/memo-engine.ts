/**
 * Configs used in memo-engine.ts:
 * fetcher.watch, fetcher.ignore
 * fetcher.scanDelay, fetcher.forceScanDelay, fetcher.docsScanDelay
 * general.customTags
 */

import { commands, TabGroupChangeEvent, TextDocument, ThemeColor, Uri, window, workspace } from "vscode";

import { Aux } from "./utils/auxiliary";
import { ConfigMaid } from "./utils/config-maid";
import { EventEmitter } from "./utils/event-emitter";
import { FileEdit } from "./utils/file-edit";
import { Janitor } from "./utils/janitor";
import { VSColors } from "./utils/vs-colors";

import CommentDelimiters from "./json/comment-delimiters.json";

/**
 * Core engine for fetching documents, memos, and other non-presentation related data module
 */
export namespace MemoEngine {
	/**
	 * Object data entry of a Memo
	 */
	export type Memo = {
		content: string;
		tag: string;
		priority: number;
		line: number;
		offset: number;
		length: number;
		fileName: string;
		relativePath: string;
		langId: keyof typeof commentDelimiters;
		raw: string;
	};

	const commentDelimiters: {
		[langId: string]: { open: string; close?: string } | { open: string; close?: string }[];
	} = CommentDelimiters;

	const tmp = Object.values(commentDelimiters)
		.flat()
		.flatMap((format) => format.close?.split(""));
	const commentCloserChars = Aux.re.escape([...new Set(tmp)].join(""));

	const watchedDocInfoMap: Map<TextDocument, { version: number; lang: string }> = new Map();
	const docMemosMap: Map<TextDocument, Memo[]> = new Map();

	let customTagColors: { [tag: string]: ThemeColor } = {};
	let customTagsUpdate = true;
	let tagColors: { [tag: string]: ThemeColor } = {};
	let tagsUpdate = true;
	let prevColorThemeType = window.activeColorTheme.kind;

	let prevFocusedDoc: string | undefined;

	/**
	 * Inits fetcher engine, event listeners and intervals
	 */
	export async function initEngine(): Promise<void> {
		ConfigMaid.onChange(["fetcher.watch", "fetcher.ignore"], () => fetchDocs({ emitUpdate: true }));
		ConfigMaid.onChange("general.customTags", () => {
			customTagsUpdate = true;
			EventEmitter.emit("update");
		});

		ConfigMaid.schedule(scheduledScan, "fetcher.scanDelay");
		ConfigMaid.schedule(scheduledForceScan, "fetcher.forceScanDelay");
		ConfigMaid.schedule(() => fetchDocs({ emitUpdate: true }), "fetcher.docsScanDelay");

		Janitor.add(
			EventEmitter.subscribe("scan", (doc: TextDocument) => scanDoc(doc, { emitUpdate: true })),

			workspace.onDidChangeWorkspaceFolders(() => {
				setTimeout(() => fetchDocs({ emitUpdate: true }), 1000);
			}),

			workspace.onDidCreateFiles(() => fetchDocs({ emitUpdate: true })),
			workspace.onDidDeleteFiles(() => fetchDocs({ emitUpdate: true })),

			workspace.onDidSaveTextDocument((doc) => {
				if (validateForScan(doc)) scanDoc(doc, { emitUpdate: true });
			}),
			window.tabGroups.onDidChangeTabGroups(onTabChange),
			window.onDidChangeActiveColorTheme((colorThemeType) => {
				if (colorThemeType.kind === prevColorThemeType) return;
				prevColorThemeType = colorThemeType.kind;
				customTagsUpdate = true;
				EventEmitter.emit("update");
			}),

			commands.registerCommand("better-memo.reloadExplorer", () => fetchMemos({ emitUpdate: true })),
		);

		await fetchMemos();
	}

	/**
	 * @returns if `doc` is watched by the fetcher engine
	 */
	export function isDocWatched(doc: TextDocument): boolean {
		return watchedDocInfoMap.has(doc);
	}

	/**
	 * @returns is `tag` is of valid form for a Memo
	 */
	export function isTagValid(tag: string): boolean {
		return RegExp(`^[^\\r\\n\t ${commentCloserChars}]+$`).test(tag);
	}

	/**
	 * @returns all currently known Memos (also updates better-memo.noMemos context as side-effect)
	 */
	export function getMemos(): Memo[] {
		const memos = [...docMemosMap.values()].flat();
		commands.executeCommand("setContext", "better-memo.noMemos", memos.length === 0);
		return memos;
	}

	/**
	 * @returns all currently known Memos in `doc`
	 */
	export function getMemosInDoc(doc: TextDocument): Memo[] {
		return docMemosMap.get(doc);
	}

	/**
	 * @returns all currently known Memos with tag `tag`
	 */
	export function getMemosWithTag(tag: string): Memo[] {
		const memos = getMemos();
		return memos.filter((memo) => memo.tag === tag);
	}

	/**
	 * @returns Memo template for `langId`, Memos is like `${head}..tag..content..${tail}`
	 */
	export function getMemoTemplate(langId: keyof typeof commentDelimiters): { head: string; tail: string } {
		const commentFormat = [commentDelimiters[langId]].flat()[0];
		const padding = commentFormat.close ? " " : "";
		return {
			head: `${commentFormat.open}${padding}MO `,
			tail: `${padding}${commentFormat.close ?? ""}`,
		};
	}

	/**
	 * - options.sortOccurrence: Sorts tags by occurrence (desc);
	 * @returns all currently known tags, together with user-defined custom tag-colors' tags
	 */
	export async function getTags(options?: { sortOccurrence?: boolean }): Promise<string[]> {
		await fetchCustomTagColors();

		let tags = getMemos()
			.map((memo) => memo.tag)
			.concat(Object.keys(customTagColors));
		if (options?.sortOccurrence) {
			const occur: { [tag: string]: number } = {};
			for (const tag of tags) {
				if (occur[tag] === undefined) occur[tag] = 0;
				occur[tag]++;
			}
			tags.sort((a, b) => occur[b] - occur[a]);
		}
		tags = [...new Set(tags)];
		return tags;
	}

	/**
	 * @returns tags mapped to hashed {@link ThemeColor}s
	 */
	export async function getTagColors(): Promise<{ [tag: string]: ThemeColor }> {
		await fetchTagColors();
		return tagColors;
	}

	/**
	 * Force the engine to forget `memos` (might be back after a scan)
	 */
	export function forgetMemos(...memos: Memo[]): void {
		for (const [doc, docMemos] of docMemosMap.entries()) {
			const removed = Aux.array.removeFrom(docMemos, ...memos);
			docMemosMap.set(doc, removed);
		}
		getMemos(); //immediately updates noMemos context
	}

	/**
	 * Force the engine to forget all currently known Memos (might be back after a scan)
	 */
	export function forgetAllMemos(): void {
		docMemosMap.clear();
		commands.executeCommand("setContext", "better-memo.noMemos", true);
	}

	/**
	 * Scans `doc` for contained Memos
	 * - options.emitUpdate: Emits update signal to view/editorDecors etc;
	 */
	export async function scanDoc(doc: TextDocument, options?: { emitUpdate?: boolean }): Promise<void> {
		const docContent = doc.getText();
		const matchRE = getMemoMatchRE(doc);

		let memos: Memo[] = [];
		for (const match of docContent.matchAll(matchRE)) {
			const tag = match.groups.tag.toUpperCase();
			const priority = match.groups.priority.length;
			const content = match.groups.content.trimEnd();

			const memoEntry = {
				content: content,
				tag: tag,
				priority: priority,
				line: doc.positionAt(match.index).line,
				offset: match.index,
				length: match[0].length,
				fileName: doc.fileName,
				relativePath: workspace.asRelativePath(doc.fileName),
				langId: doc.languageId,
				raw: match[0],
			};
			memos.push(memoEntry);
		}

		docMemosMap.set(doc, memos);
		if (options?.emitUpdate) {
			tagsUpdate = true;
			EventEmitter.emit("update");
		}
	}

	/**
	 * Fetches supported text documents from current workspace to watch,
	 * also executing a force scan on documents
	 * - options.emitUpdate: Emits update signal to view/editorDecors etc;
	 */
	async function fetchDocs(options?: { emitUpdate?: boolean }): Promise<void> {
		const watch = `{${ConfigMaid.get("fetcher.watch").join(",")}}`;
		const ignore = `{${ConfigMaid.get("fetcher.ignore").join(",")}}`;

		const getDoc = async (uri: Uri) => {
			try {
				return await workspace.openTextDocument(uri);
			} catch {}
		};
		const fileUris = await workspace.findFiles(watch, ignore);
		const files = await Aux.async.map(fileUris, async (uri) => await getDoc(uri));
		const docs = files.filter((doc) => commentDelimiters[doc?.languageId]);

		watchedDocInfoMap.clear();
		for (const doc of docs) watchedDocInfoMap.set(doc, { version: doc.version, lang: doc.languageId });
		for (const doc of docMemosMap.keys()) if (!isDocWatched(doc)) docMemosMap.delete(doc);
		await Aux.async.map(watchedDocInfoMap.keys(), async (doc) => await scanDoc(doc));
		if (options?.emitUpdate) EventEmitter.emit("update");
	}

	/**
	 * Runs {@link fetchDocs()} and then runs {@link scanDoc()} for every retrieved document
	 * - options.emitUpdate: Emits update signal to view/editorDecors etc;
	 */
	async function fetchMemos(options?: { emitUpdate?: boolean }): Promise<void> {
		await fetchDocs();
		await Aux.async.map(watchedDocInfoMap.keys(), async (doc) => await scanDoc(doc));
		if (options?.emitUpdate) EventEmitter.emit("update");
	}

	/**
	 * Fetches tags-ThemeColors map and stores in {@link tagColors}
	 */
	async function fetchTagColors(): Promise<void> {
		if (!tagsUpdate) return;

		await fetchCustomTagColors();
		const newTagColors: { [tag: string]: ThemeColor } = {};
		for (const tag of await getTags()) newTagColors[tag] = customTagColors[tag] ?? VSColors.hash(tag);
		tagColors = newTagColors;
		tagsUpdate = false;
	}

	/**
	 * Fetches customTags-ThemeColors map and stores in {@link customTagColors}
	 */
	async function fetchCustomTagColors(): Promise<void> {
		if (!customTagsUpdate) return;

		const userCustomTagColors: { [tag: string]: string } = ConfigMaid.get("general.customTags");
		const validCustomTagColors: { [tag: string]: ThemeColor } = {};
		const validHEXRE = /(?:^#?[0-9a-f]{6}$)|(?:^#?[0-9a-f]{3}$)/i;
		for (let [tag, hex] of Object.entries(userCustomTagColors)) {
			[tag, hex] = [tag.trim().toUpperCase(), hex.trim()];
			if (!isTagValid(tag) || !validHEXRE.test(hex)) continue;
			validCustomTagColors[tag] = VSColors.interpolate(hex);
		}
		customTagColors = validCustomTagColors;
		customTagsUpdate = false;
	}

	/**
	 * @returns `RegExp` for matching Memos in `doc`
	 */
	function getMemoMatchRE(doc: TextDocument): RegExp {
		const delimiters = [commentDelimiters[doc.languageId]].flat();
		const commentFormatREs = delimiters.map((del) => {
			const open = Aux.re.escape(del.open);
			const close = Aux.re.escape(del.close ?? "");
			return `(?<![${open}])${open}[\\t ]*mo[\\t ]+(?<tag>[^\\r\\n\\t ${commentCloserChars}]+)[\\t ]*(?<priority>!*)(?<content>.*${
				close ? "?" : ""
			})${close}`;
		});
		const matchPattern = Aux.re.union(...commentFormatREs);
		return RegExp(matchPattern, "gim");
	}

	/**
	 * @returns formatted pretty-looking version of `memo`.raw
	 */
	function getFormattedMemo(memo: Memo): string {
		const template = getMemoTemplate(memo.langId);
		return `${template.head}${memo.tag}${memo.content ? " " : ""}${"!".repeat(memo.priority)}${memo.content}${
			template.tail
		}`;
	}

	/**
	 * Formats all Memos in `doc` with {@link getFormattedMemo()}
	 */
	async function formatMemosInDoc(doc: TextDocument): Promise<void> {
		await scanDoc(doc);
		const memos = getMemosInDoc(doc);
		if (memos.length === 0) return;

		const edit = new FileEdit.Edit();
		for (const memo of memos) {
			edit.replace(doc.uri, [memo.offset, memo.offset + memo.length], getFormattedMemo(memo));
		}
		await edit.apply();
	}

	/**
	 * Validates `doc` for a scan (if not forced)
	 */
	function validateForScan(doc?: TextDocument): boolean {
		const docInfo = watchedDocInfoMap.get(doc);
		if (!docInfo) return false;
		const versionChanged = doc.version !== docInfo.version;
		const langChanged = doc.languageId !== docInfo.lang;
		if (versionChanged) docInfo.version = doc.version;
		if (langChanged) docInfo.lang = doc.languageId;
		return versionChanged || langChanged;
	}

	/**
	 * Normal scanning schedule, is not forced and doc is validated for a scan,
	 * the scan only scans the currently active document
	 */
	function scheduledScan(): void {
		const doc = window.activeTextEditor?.document;
		if (doc && validateForScan(doc)) scanDoc(doc, { emitUpdate: true });
	}

	/**
	 * Force scanning schedule, to prevent cases where {@link scheduledScan()} mal-functioned,
	 * the scan only scans the currently active document
	 */
	function scheduledForceScan(): void {
		const doc = window.activeTextEditor?.document;
		if (!doc || !isDocWatched(doc)) return;
		scanDoc(doc, { emitUpdate: true });
	}

	/**
	 * Handles tab change and formats document's Memos accordingly
	 */
	async function onTabChange(ev: TabGroupChangeEvent): Promise<void> {
		for (const changedTab of ev.changed) {
			if (!changedTab.isActive) continue;
			const activeTab = changedTab.activeTab;
			if (!activeTab) {
				prevFocusedDoc = undefined;
				break;
			}
			if (!activeTab.isActive || activeTab.label === prevFocusedDoc) continue;

			let doc;
			try {
				doc = await workspace.openTextDocument((<{ uri?: Uri }>activeTab.input).uri);
			} catch {
				continue;
			}
			if (!isDocWatched(doc)) continue;

			prevFocusedDoc = activeTab.label;
			await formatMemosInDoc(doc);
			break;
		}
	}
}
