import { TextDocument, window } from "vscode";

import { Doc } from "./doc";
import { Lang } from "./lang";
import { Memo } from "./memo";
import { Tag } from "./tag";

export namespace Scan {
	export async function clean(): Promise<void> {
		Lang.data = Lang.getData();

		Doc.data = await Doc.getData();

		Memo.data = await Memo.getData({ flush: true });

		Tag.data = Tag.getData();
	}

	export async function filesChanged(): Promise<void> {
		const newDocData = await Doc.getData();

		const docs = Doc.data.docs;
		const newDocs = newDocData.docs;
		Doc.data = newDocData;

		const createdDocs = newDocs.filter((doc) => !docs.includes(doc));
		const deletedDocs = docs.filter((doc) => !newDocs.includes(doc));

		Memo.data = await Memo.getData({ rescan: createdDocs.concat(deletedDocs) });

		Tag.data = Tag.getData();
	}

	export async function doc(
		doc: TextDocument,
		options?: { flush?: boolean },
	): Promise<boolean> {
		if (!options?.flush && !Doc.isChanged(doc)) return false;

		Memo.data = await Memo.getData({
			rescan: [doc],
			flush: options?.flush,
		});

		Tag.data = Tag.getData();

		return true;
	}

	export async function docs(
		docs: TextDocument[],
		options?: { flush?: boolean },
	): Promise<void> {
		for (const doc of docs) {
			Memo.data = await Memo.getData({
				rescan: [doc],
				flush: options?.flush,
			});
		}

		Tag.data = Tag.getData();
	}

	export async function activeDoc(options?: {
		flush?: boolean;
	}): Promise<boolean> {
		const active = window.activeTextEditor?.document;
		if (!active) return false;

		return await Scan.doc(active, options);
	}
}
