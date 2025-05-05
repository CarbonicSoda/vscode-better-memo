import { TextDocument } from "vscode";

import { FileEdit } from "../utils/file-edit";
import { Memo } from "./memo";
import { Lang } from "./lang";

export namespace Format {
	export async function formatDoc(doc: TextDocument): Promise<void> {
		const list = Memo.inDoc(doc);
		if (list.length === 0) return;

		const edit = new FileEdit.Edit();

		for (const memo of list) {
			edit.replace(doc, [memo.meta.start, memo.meta.end], toFormatted(memo));
		}

		await edit.apply();
	}

	function toFormatted(memo: Memo.Memo): string {
		const template = getTemplate(memo.meta.lang);

		return `${template.head}${memo.tag}${memo.content ? " " : ""}${"!".repeat(
			memo.priority,
		)}${memo.content}${template.tail}`;
	}

	export function getTemplate(lang: string): { head: string; tail: string } {
		if (!Lang.includes(lang)) return { head: "", tail: "" };

		const delimiters = Lang.data.delimiters[lang];
		const padding = delimiters.close ? " " : "";

		return {
			head: `${delimiters.open}${padding}MO `,
			tail: `${padding}${delimiters.close ?? ""}`,
		};
	}
}
