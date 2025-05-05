import { ThemeColor } from "vscode";

import { Colors } from "../utils/colors";
import { Config } from "../utils/config";
import { Lang } from "./lang";
import { Memo } from "./memo";

export namespace Tag {
	type TagColors = { [tag: string]: ThemeColor };

	export let data: { tags: string[]; colors: TagColors } = getData();

	export function isValid(tag: string): boolean {
		return RegExp(`^[^\\s${Lang.data.closersRE}!]+$`).test(tag);
	}

	export function getData(): typeof data {
		const colors: (typeof data)["colors"] = {};

		for (const { tag } of Memo.data.memos) colors[tag] = Colors.hash(tag);

		const customTags = Config.get("customTags") as {
			[tag: string]: string;
		};

		for (let [tag, hex] of Object.entries(customTags)) {
			[tag, hex] = [tag.trim().toUpperCase(), hex.trim()];

			if (!isValid(tag)) continue;

			colors[tag] = Colors.interpolate(hex);
		}

		const tags = Object.keys(colors);

		return { tags, colors };
	}
}
