import { TextDocument, window } from "vscode";

import { Doc } from "./doc";
import { Lang } from "./lang";
import { Memo } from "./memo";
import { Tag } from "./tag";

export namespace Scan {
	export async function clean(): Promise<void> {
		Lang.data = Lang.getData();
		Doc.data = await Doc.getData();
		Memo.data = Memo.getData();
		Tag.data = Tag.getData();
	}

	export async function filesChanged(): Promise<void> {
		const newDocData = await Doc.getData();

		const docs = Doc.data.docs;
		const newDocs = newDocData.docs;
		Doc.data = newDocData;

		const createdDocs = newDocs.filter((doc) => !docs.includes(doc));
		const deletedDocs = docs.filter((doc) => !newDocs.includes(doc));

		Memo.data = Memo.getData(createdDocs.concat(deletedDocs));
	}

	export function doc(doc: TextDocument): void {
		if (!Doc.isChanged(doc)) return;

		Memo.data = Memo.getData([doc]);
	}

	export function activeDoc(): void {
		const active = window.activeTextEditor?.document;
		if (!active) return;

		Scan.doc(active);
	}
}
