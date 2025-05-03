import { TextDocument, workspace } from "vscode";

import { Aux } from "../utils/auxiliary";
import { Config } from "../utils/config";
import { Lang } from "./lang";

export namespace Doc {
	type DocMeta = { version: number; lang: string };

	export let data: {
		docs: TextDocument[];
		metas: Map<TextDocument, DocMeta>;
	} = { docs: [], metas: new Map() };

	export function includes(doc: TextDocument): boolean {
		if (data.metas.has(doc)) return true;

		for (const watched of data.docs) {
			if (watched.fileName === doc.fileName) return true;
		}
		return false;
	}

	export function isChanged(doc: TextDocument): boolean {
		const meta = data.metas.get(doc);
		if (!meta) return false;

		const { version, languageId: lang } = doc;
		data.metas.set(doc, { version, lang });

		const isChanged = version !== meta.version || lang !== meta.lang;

		return isChanged;
	}

	export async function getData(): Promise<typeof data> {
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

		const docs = textDocs.filter((doc) => Lang.includes(doc.languageId));

		const metas: (typeof data)["metas"] = new Map();
		for (const doc of docs) {
			metas.set(doc, { version: doc.version, lang: doc.languageId });
		}

		return { docs, metas };
	}
}
