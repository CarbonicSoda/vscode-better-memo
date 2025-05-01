/**
 * Configs used in memo-engine.ts:
 * fetcher.watch, fetcher.ignore
 * fetcher.scanDelay, fetcher.forceScanDelay, fetcher.docsScanDelay
 * general.customTags
 */

import {
	commands,
	Position,
	TabGroupChangeEvent,
	TextDocument,
	ThemeColor,
	Uri,
	window,
	workspace,
} from "vscode";

import { Aux } from "./utils/auxiliary";
import { Config } from "./utils/config";
import { EventEmitter } from "./utils/event-emitter";
import { FileEdit } from "./utils/file-edit";
import { Janitor } from "./utils/janitor";
import { Colors } from "./utils/colors";

import PredefinedLangs from "./json/predefined-langs.json";

/**
 * Core engine for fetching documents, memos, and other non-presentation related data module
 */
export namespace MemoEngine {
	//#region langs
	type LangDelimiters = {
		[langId: string]: { open: string; close?: string };
	};

	let langs: {
		list: string[];
		delimiters: LangDelimiters;

		closers: string[];
		closersRE: string;

		includes: (lang: string) => boolean;
	} = getLangs();

	/**
	 * Get defined language details
	 */
	function getLangs(): typeof langs {
		const customLangs = Config.get("general.customLanguages") ?? {};

		const delimiters: (typeof langs)["delimiters"] = {
			...PredefinedLangs,
			...customLangs,
		};
		const closers = Object.values(delimiters).flatMap((comment) => {
			return comment.close?.split("") ?? [];
		});
		const closersRE = Aux.re.escape([...new Set(closers)].join(""));

		return {
			list: Object.keys(delimiters),
			delimiters,

			closers,
			closersRE,

			includes(lang) {
				return !!delimiters[lang];
			},
		};
	}

	//#endregion langs

	//#region docs
	type DocMeta = { version: number; lang: string };

	let docs: {
		list: TextDocument[];
		metas: Map<TextDocument, DocMeta>;

		includes: (doc: TextDocument) => boolean;
	} = {
		list: [],
		metas: new Map(),

		includes(doc) {
			if (this.metas.has(doc)) return true;

			for (const watched of this.list) {
				if (watched.fileName === doc.fileName) return true;
			}
			return false;
		},
	};

	/**
	 * Get fetches docs
	 */
	async function getDocs(): Promise<typeof docs> {
		const watch = `{${Config.get("fetcher.watch").join(",")}}`;
		const ignore = `{${Config.get("fetcher.ignore").join(",")}}`;

		const uris = await workspace.findFiles(watch, ignore);
		const textDocs = (
			await Aux.async.map(uris, async (uri) => {
				try {
					return await workspace.openTextDocument(uri);
				} catch {}
			})
		).filter((opened) => opened !== undefined);

		const list = textDocs.filter((doc) => langs.includes(doc.languageId));

		const metas: (typeof docs)["metas"] = new Map();
		for (const doc of list) {
			metas.set(doc, { version: doc.version, lang: doc.languageId });
		}

		return {
			list,
			metas,

			includes: docs.includes,
		};
	}

	//#endregion docs

	//#region memos
	type MemoMeta = {
		doc: TextDocument;
		lang: string;
		file: string;
		path: string;

		start: Position;
		end: Position;
		line: number;
	};
	export type Memo = {
		raw: string;

		tag: string;
		priority: number;
		content: string;

		meta: MemoMeta;
	};

	export let memos: {
		list: Memo[];
		resides: Map<TextDocument, Memo[]>;

		ofTag: (tag: string) => Memo[];
		inDoc: (doc: TextDocument) => Memo[];
	} = {
		list: [],
		resides: new Map(),

		ofTag(tag) {
			return this.list.filter((memo) => memo.tag === tag);
		},
		inDoc(doc) {
			return this.resides.get(doc) ?? [];
		},
	};

	/**
	 * Fetch all memos in documents
	 * @param rescan only rescan specified documents
	 */
	function getMemos(rescan?: TextDocument[]): typeof memos {
		const resides: (typeof memos)["resides"] = rescan
			? memos.resides
			: new Map();

		for (const doc of rescan ?? docs.list) {
			if (rescan && !docs.list.includes(doc)) resides.delete(doc);
			else resides.set(doc, getDocMemos(doc));
		}

		const list = Array.from(resides.values()).flat();

		return {
			list,
			resides,

			ofTag: memos.ofTag,
			inDoc: memos.inDoc,
		};
	}

	/**
	 * @returns all memos in `doc`
	 */
	function getDocMemos(doc: TextDocument): Memo[] {
		const lang = doc.languageId;
		const file = doc.fileName;
		const path = workspace.asRelativePath(doc.uri);

		let list: Memo[] = [];

		const src = doc.getText();
		const matchRE = getMemoRE(doc.languageId);

		for (const match of src.matchAll(matchRE)) {
			const raw = match[0].trimEnd();

			const start = doc.positionAt(match.index);
			const end = start.translate(0, raw.length);
			const line = start.line;

			const groups = match.groups as {
				tag: string;
				priority: string;
				content: string;
			};
			const tag = groups.tag.toUpperCase();
			const priority = groups.priority.length;
			const content = groups.content.trimEnd();

			list.push({
				raw,

				tag,
				priority,
				content,

				meta: {
					doc,
					lang,
					file,
					path,

					start,
					end,
					line,
				},
			});
		}

		return list;
	}

	/**
	 * @returns `RegExp` for matching memos in `doc`
	 */
	function getMemoRE(lang: string): RegExp {
		if (!langs.includes(lang)) return RegExp.prototype;

		const delimiters = langs.delimiters[lang];

		const open = Aux.re.escape(delimiters.open);
		const close = delimiters.close ? Aux.re.escape(delimiters.close) : "";

		const matchPattern = `(?<![${open}])${open}[\\t ]*mo[\\t ]+(?<tag>[^\\r\\n\\t ${
			langs.closersRE
		}]+)[\\t ]*(?<priority>!*)(?<content>.*${close ? "?" : ""})${close}`;

		return RegExp(matchPattern, "gim");
	}

	//#endregion memos

	//#region tags
	type TagColors = {
		[tag: string]: ThemeColor;
	};

	export let tags: {
		list: string[];
		colors: TagColors;

		includes: (tag: string) => boolean;
	} = getTags();

	/**
	 * Get existing tag details
	 */
	function getTags(): typeof tags {
		const colors: (typeof tags)["colors"] = {};

		for (const { tag } of memos.list) colors[tag] = Colors.hash(tag);

		const customTags = Config.get("general.customTags") as {
			[tag: string]: string;
		};

		for (let [tag, hex] of Object.entries(customTags)) {
			[tag, hex] = [tag.trim().toUpperCase(), hex.trim()];
			if (!RegExp(`^[^\\r\\n\t ${langs.closersRE}]+$`).test(tag)) continue;

			colors[tag] = Colors.interpolate(hex);
		}

		return {
			list: Object.keys(colors),
			colors,

			includes(tag) {
				return !!colors[tag];
			},
		};
	}

	//MO TODO sorter will be moved to usage
	// /**
	//  * @returns all currently known tags together with user-defined custom tags
	//  * sorted by occurrence (desc)
	//  */
	// export function getTagList(): string[] {
	// 	const tagList = tags.list;

	// 	const occurrence: { [tag: string]: number } = {};
	// 	for (const tag of tagList) {
	// 		occurrence[tag] ??= 0;
	// 		occurrence[tag]++;
	// 	}

	// 	return tagList.sort((a, b) => occurrence[b] - occurrence[a]);
	// }

	//#endregion tags

	//#region scans
	function updateView(): void {
		EventEmitter.emit("UpdateView");
	}

	export async function scanClean(): Promise<void> {
		langs = getLangs();
		docs = await getDocs();
		memos = getMemos();
		tags = getTags();
	}

	async function scanFsChange(): Promise<void> {
		const newDocs = await getDocs();

		const createdDocs = newDocs.list.filter((doc) => !docs.includes(doc));
		const deletedDocs = docs.list.filter((doc) => !newDocs.includes(doc));

		docs = newDocs;
		memos = getMemos(createdDocs.concat(deletedDocs));
	}

	/**
	 * Scan the current document and update view
	 */
	function scanDoc(): void {
		const doc = window.activeTextEditor?.document;
		if (!doc || !isDocChanged(doc)) return;

		memos = getMemos([doc]);
		updateView();
	}

	/**
	 * Check if `doc` is changed, either version or languageId
	 */
	function isDocChanged(doc: TextDocument): boolean {
		const meta = docs.metas.get(doc);
		if (!meta) return false;

		const { version, languageId: lang } = doc;
		const isChanged = version !== meta.version || lang !== meta.lang;

		docs.metas.set(doc, {
			version,
			lang,
		});

		return isChanged;
	}

	//#endregion scans

	//#region aux
	/**
	 * Handles tab change and formats doc memos
	 */
	async function onTabChange(ev: TabGroupChangeEvent): Promise<void> {
		for (const tab of ev.changed) {
			const activeTab = tab.activeTab;

			if (!tab.isActive || !activeTab || !activeTab?.isActive) {
				continue;
			}

			let doc;
			try {
				doc = await workspace.openTextDocument(
					(activeTab.input as { uri: Uri }).uri,
				);
			} catch {
				continue;
			}

			if (docs.includes(doc)) await formatDoc(doc);
		}
	}

	/**
	 * Format all memos in `doc`
	 */
	async function formatDoc(doc: TextDocument): Promise<void> {
		const list = memos.inDoc(doc);
		if (list.length === 0) return;

		const edit = new FileEdit.Edit();

		for (const memo of list) {
			edit.replace(
				doc.uri,
				[memo.meta.start, memo.meta.end],
				toFormatted(memo),
			);
		}

		await edit.apply();
	}

	/**
	 * @returns formatted pretty-looking version of memo
	 */
	function toFormatted(memo: Memo): string {
		const template = getTemplate(memo.meta.lang);

		return `${template.head}${memo.tag}${memo.content ? " " : ""}${"!".repeat(
			memo.priority,
		)}${memo.content}${template.tail}`;
	}

	/**
	 * @returns memo templaters for `lang`
	 */
	export function getTemplate(lang: string): {
		head: string;
		tail: string;
	} {
		if (!langs.includes(lang)) return { head: "", tail: "" };

		const delimiters = langs.delimiters[lang];
		const padding = delimiters.close ? " " : "";

		return {
			head: `${delimiters.open}${padding}MO `,
			tail: `${padding}${delimiters.close ?? ""}`,
		};
	}

	//#endregion aux

	/**
	 * Init fetcher engine, event listeners and intervals
	 */
	export async function init(): Promise<void> {
		Config.onChange("general.customTags", () => {
			tags = getTags();
			updateView();
		});

		Config.onChange("general.customLanguages", async () => {
			langs = getLangs();
			await scanFsChange();
			updateView();
		});

		Config.onChange(["fetcher.watch", "fetcher.ignore"], async () => {
			await scanFsChange();
			updateView();
		});

		Config.schedule(scanDoc, "fetcher.scanDelay");

		Config.schedule(scanClean, "fetcher.cleanScanDelay");

		Janitor.add(
			commands.registerCommand("better-memo.reloadExplorer", async () => {
				await scanClean();
				updateView();
			}),

			workspace.onDidChangeWorkspaceFolders(async () => {
				await scanFsChange();
				updateView();
			}),

			workspace.onDidCreateFiles(async () => {
				await scanFsChange();
				updateView();
			}),
			workspace.onDidDeleteFiles(async () => {
				await scanFsChange();
				updateView();
			}),

			workspace.onDidSaveTextDocument(scanDoc),

			window.onDidChangeActiveColorTheme(() => {
				tags = getTags();
				updateView();
			}),

			window.tabGroups.onDidChangeTabGroups(onTabChange),
		);

		await scanFsChange();
	}
}
