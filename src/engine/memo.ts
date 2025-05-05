import { Position, TextDocument, workspace } from "vscode";

import { Aux } from "../utils/auxiliary";
import { Doc } from "./doc";
import { Lang } from "./lang";

export namespace Memo {
	type MemoMeta = {
		doc: TextDocument;
		path: string;
		lang: string;

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

	export let data: { memos: Memo[]; docmap: Map<string, Memo[]> } = {
		memos: [],
		docmap: new Map(),
	};

	export function ofTag(tag: string): Memo[] {
		return data.memos.filter((memo) => memo.tag === tag);
	}

	export function inDoc(doc: TextDocument): Memo[] {
		return data.docmap.get(doc.fileName) ?? [];
	}

	export async function getData(options?: {
		rescan?: TextDocument[];
		flush?: boolean;
	}): Promise<typeof data> {
		const docmap: (typeof data)["docmap"] = options?.rescan
			? data.docmap
			: new Map();

		await Aux.async.map(options?.rescan ?? Doc.data.docs, async (doc) => {
			if (options?.rescan && !Doc.includes(doc)) docmap.delete(doc.fileName);
			else docmap.set(doc.fileName, await getDocMemos(doc, options));
		});

		const memos = Array.from(docmap.values()).flat();

		return { memos, docmap };
	}

	async function getDocMemos(
		doc: TextDocument,
		options?: { flush?: boolean },
	): Promise<Memo[]> {
		const path = workspace.asRelativePath(doc.uri);
		const lang = doc.languageId;

		let memos: Memo[] = [];

		const src = options?.flush
			? new TextDecoder().decode(await workspace.fs.readFile(doc.uri))
			: doc.getText();
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

			memos.push({
				raw,

				tag,
				priority,
				content,

				meta: {
					doc,
					path,
					lang,

					start,
					end,
					line,
				},
			});
		}

		return memos;
	}

	function getMemoRE(lang: string): RegExp {
		if (!Lang.includes(lang)) return RegExp.prototype;

		const delimiters = Lang.data.delimiters[lang];

		const open = Aux.re.escape(delimiters.open);
		const close = delimiters.close ? Aux.re.escape(delimiters.close) : "";

		const matchPattern = `(?<![${open}])${open}[\\t ]*mo[\\t ]+(?<tag>[^\\s${
			Lang.data.closersRE
		}!]+)[\\t ]*(?<priority>!*)(?<content>.*${close ? "?" : ""})${close}`;

		return RegExp(matchPattern, "gi");
	}
}
