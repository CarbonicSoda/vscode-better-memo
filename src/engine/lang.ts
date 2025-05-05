import { Aux } from "../utils/auxiliary";
import { Config } from "../utils/config";

import PredefinedLangs from "../json/predefined-langs.json";

export namespace Lang {
	export let data: {
		langs: string[];

		delimiters: {
			[langId: string]: { open: string; close?: string };
		};

		closers: string[];
		closersRE: string;
	} = getData();

	export function includes(lang: string): boolean {
		return !!data.delimiters[lang];
	}

	export function getData(): typeof data {
		const customLangs = Config.get("customLangs") ?? {};

		const delimiters: (typeof data)["delimiters"] = {
			...PredefinedLangs,
			...customLangs,
		};

		const closers = Object.values(delimiters).flatMap((comment) => {
			return comment.close?.split("") ?? [];
		});
		const closersRE = Aux.re.escape([...new Set(closers)].join(""));

		const langs = Object.keys(delimiters);

		return {
			langs,

			delimiters,

			closers,
			closersRE,
		};
	}
}
