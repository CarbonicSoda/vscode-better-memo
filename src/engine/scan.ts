import { window } from "vscode";

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

	export function currentDoc(): void {
		const doc = window.activeTextEditor?.document;
		if (!doc || !Doc.isChanged(doc)) return;

		Memo.data = Memo.getData([doc]);
	}
}
