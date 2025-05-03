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

	export let data: { memos: Memo[]; docmap: Map<TextDocument, Memo[]> } = {
		memos: [],
		docmap: new Map(),
	};

	export function ofTag(tag: string): Memo[] {
		return data.memos.filter((memo) => memo.tag === tag);
	}

	export function inDoc(doc: TextDocument): Memo[] {
		return data.docmap.get(doc) ?? [];
	}

	export function getData(rescan?: TextDocument[]): typeof data {
		const docmap: (typeof data)["docmap"] = rescan ? data.docmap : new Map();

		for (const doc of rescan ?? Doc.data.docs) {
			if (rescan && !Doc.includes(doc)) docmap.delete(doc);
			else docmap.set(doc, getDocMemos(doc));
		}

		const memos = Array.from(docmap.values()).flat();

		return { memos, docmap };
	}

	function getDocMemos(doc: TextDocument): Memo[] {
		const path = workspace.asRelativePath(doc.uri);
		const lang = doc.languageId;

		let memos: Memo[] = [];

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

		const matchPattern = `(?<![${open}])${open}[\\t ]*mo[\\t ]+(?<tag>[^\\r\\n\\t ${
			Lang.data.closersRE
		}]+)[\\t ]*(?<priority>!*)(?<content>.*${close ? "?" : ""})${close}`;

		return RegExp(matchPattern, "gim");
	}
}
