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

export namespace MemoEngine {
	const commentDelimiters: {
		[langId: string]: { open: string; close?: string } | { open: string; close?: string }[];
	} = CommentDelimiters;

	type MemoEntry = {
		content: string;
		tag: string;
		priority: number;
		line: number;
		offset: number;
		length: number;
		path: string;
		relativePath: string;
		langId: keyof typeof commentDelimiters;
		raw: string;
	};
	export class Memo {
		readonly content: string;
		readonly tag: string;
		readonly priority: number;
		readonly line: number;
		readonly offset: number;
		readonly length: number;
		readonly path: string;
		readonly relativePath: string;
		readonly langId: keyof typeof commentDelimiters;
		readonly raw: string;

		constructor(entry: MemoEntry) {
			({
				content: this.content,
				tag: this.tag,
				priority: this.priority,
				line: this.line,
				offset: this.offset,
				length: this.length,
				path: this.path,
				relativePath: this.relativePath,
				langId: this.langId,
				raw: this.raw,
			} = entry);
		}
	}

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

	export async function initEngine(): Promise<void> {
		ConfigMaid.onChange(["fetcher.watch", "fetcher.ignore"], fetchDocs);
		ConfigMaid.onChange("general.customTags", () => {
			customTagsUpdate = true;
			EventEmitter.emit("update");
		});

		ConfigMaid.newInterval(scanInterval, "fetcher.scanDelay");
		ConfigMaid.newInterval(forceScanInterval, "fetcher.forceScanDelay");
		ConfigMaid.newInterval(fetchDocs, "fetcher.docsScanDelay");

		Janitor.add(
			EventEmitter.subscribe("scan", (doc: TextDocument) => scanDoc(doc, { emitUpdate: true })),

			workspace.onDidCreateFiles(fetchDocs),
			workspace.onDidDeleteFiles(fetchDocs),

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

	export function isDocWatched(doc: TextDocument): boolean {
		return watchedDocInfoMap.has(doc);
	}

	export function isTagValid(tag: string): boolean {
		return RegExp(`^[^\\r\\n\t ${commentCloserChars}]+$`).test(tag);
	}

	export function getMemos(): Memo[] {
		const memos = [...docMemosMap.values()].flat();
		commands.executeCommand("setContext", "better-memo.noMemos", memos.length === 0);
		return memos;
	}

	export function getMemosInDoc(doc: TextDocument): Memo[] {
		return docMemosMap.get(doc);
	}

	export function getMemosWithTag(tag: string): Memo[] {
		const memos = getMemos();
		return memos.filter((memo) => memo.tag === tag);
	}

	export function getMemoTemplate(langId: keyof typeof commentDelimiters): { head: string; tail: string } {
		const commentFormat = [commentDelimiters[langId]].flat()[0];
		const padding = commentFormat.close ? " " : "";
		return {
			head: `${commentFormat.open}${padding}MO `,
			tail: `${padding}${commentFormat.close ?? ""}`,
		};
	}

	export function getTags(options?: { sortOccurrence?: boolean }): string[] {
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

	export async function getTagColors(): Promise<{ [tag: string]: ThemeColor }> {
		await fetchTagColors();
		return tagColors;
	}

	export function forgetMemos(...memos: Memo[]): void {
		for (const [doc, docMemos] of docMemosMap.entries()) {
			const removed = docMemos.filter((memo) => !memos.includes(memo));
			docMemosMap.set(doc, removed);
		}
		getMemos(); //immediately updates noMemos context
	}

	export function forgetAllMemos(): void {
		docMemosMap.clear();
		commands.executeCommand("setContext", "better-memo.noMemos", true);
	}

	export async function scanDoc(
		doc: TextDocument,
		options?: { emitUpdate?: boolean; ignoreLazyMode?: boolean },
	): Promise<void> {
		const docContent = doc.getText();
		const matchRE = getMemoMatchRE(doc);

		let memos: Memo[] = [];
		await Aux.async.map(docContent.matchAll(matchRE), async (match) => {
			let tag: string;
			let priority: number;
			let content: string;
			for (const [group, value] of Object.entries(match.groups)) {
				if (value === undefined) continue;
				if (group.startsWith("tag")) {
					tag = value.toUpperCase();
					continue;
				}
				if (group.startsWith("priority")) {
					priority = value.length;
					continue;
				}
				if (group.startsWith("content")) {
					content = value.trimEnd();
					continue;
				}
				break;
			}

			const memoEntry = {
				content: content,
				tag: tag,
				priority: priority,
				line: doc.positionAt(match.index).line,
				offset: match.index,
				length: match[0].length,
				path: doc.fileName,
				relativePath: workspace.asRelativePath(doc.fileName),
				langId: doc.languageId,
				raw: match[0],
			};
			memos.push(new Memo(memoEntry));
		});

		docMemosMap.set(doc, memos);
		if (options?.emitUpdate) {
			tagsUpdate = true;
			EventEmitter.emit("update");
		}
	}

	async function fetchDocs(): Promise<void> {
		const watch = `{${ConfigMaid.get("fetcher.watch").join(",")}}`;
		const ignore = `{${ConfigMaid.get("fetcher.ignore").join(",")}}`;

		const getDoc = async (uri: Uri) => {
			try {
				return await workspace.openTextDocument(uri);
			} finally {
			}
		};
		const fileUris = await workspace.findFiles(watch, ignore);
		const files = await Aux.async.map(fileUris, async (uri) => await getDoc(uri));
		const docs = files.filter((doc) => commentDelimiters[doc?.languageId]);

		watchedDocInfoMap.clear();
		for (const doc of docs) watchedDocInfoMap.set(doc, { version: doc.version, lang: doc.languageId });
		for (const doc of docMemosMap.keys()) if (!isDocWatched(doc)) docMemosMap.delete(doc);
		for (const doc of watchedDocInfoMap.keys()) if (!isDocWatched(doc)) scanDoc(doc);
	}

	async function fetchMemos(options?: { emitUpdate?: boolean }): Promise<void> {
		await fetchDocs();
		await Aux.async.map(watchedDocInfoMap.keys(), async (doc) => await scanDoc(doc));
		if (options?.emitUpdate) EventEmitter.emit("update");
	}

	async function fetchTagColors(): Promise<void> {
		if (!tagsUpdate) return;
		await fetchCustomTagColors();
		const newTagColors: { [tag: string]: ThemeColor } = {};
		await Aux.async.map(
			getTags(),
			async (tag) => (newTagColors[tag] = customTagColors[tag] ?? VSColors.hashColor(tag)),
		);
		tagColors = newTagColors;
		tagsUpdate = false;
	}

	async function fetchCustomTagColors(): Promise<void> {
		if (!customTagsUpdate) return;

		const userCustomTagColors: { [tag: string]: string } = ConfigMaid.get("general.customTags");
		const validCustomTagColors: { [tag: string]: ThemeColor } = {};
		const validHEXRE = /(?:^#?[0-9a-f]{6}$)|(?:^#?[0-9a-f]{3}$)/i;
		await Aux.async.map(Object.entries(userCustomTagColors), async ([tag, hex]) => {
			[tag, hex] = [tag.trim().toUpperCase(), hex.trim()];
			if (!isTagValid(tag) || !validHEXRE.test(hex)) return;
			validCustomTagColors[tag] = VSColors.interpolate(hex);
		});
		customTagColors = validCustomTagColors;
		customTagsUpdate = false;
	}

	function getMemoMatchRE(doc: TextDocument): RegExp {
		const delimiters = [commentDelimiters[doc.languageId]].flat();
		const commentFormatREs = delimiters.map((del, i) => {
			const open = Aux.re.escape(del.open);
			const close = Aux.re.escape(del.close ?? "");
			return `(?<![${open}])${open}[\\t ]*mo[\\t ]+(?<tag${i}>[^\\r\\n\\t ${commentCloserChars}]+)[\\t ]*(?<priority${i}>!*)(?<content${i}>.*${
				close ? "?" : ""
			})${close}`;
		});
		const matchPattern = Aux.re.union(...commentFormatREs);
		return RegExp(matchPattern, "gim");
	}

	function getFormattedMemo(memo: Memo): string {
		const template = getMemoTemplate(memo.langId);
		return `${template.head}${memo.tag}${memo.content ? " " : ""}${"!".repeat(memo.priority)}${memo.content}${
			template.tail
		}`;
	}

	async function formatMemosInDoc(doc: TextDocument): Promise<void> {
		await scanDoc(doc, { ignoreLazyMode: true });
		const memos = getMemosInDoc(doc);
		if (memos.length === 0) return;

		const edit = new FileEdit.Edit();
		for (const memo of memos)
			edit.replace(doc.uri, [memo.offset, memo.offset + memo.length], getFormattedMemo(memo));
		await edit.apply();
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
		if (doc && validateForScan(doc)) scanDoc(doc, { emitUpdate: true });
	}

	function forceScanInterval(): void {
		const doc = window.activeTextEditor?.document;
		if (!doc || !isDocWatched(doc)) return;
		scanDoc(doc, { emitUpdate: true });
	}

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
