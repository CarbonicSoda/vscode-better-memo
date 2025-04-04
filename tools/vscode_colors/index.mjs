// All code unoptimized, as they will only be ran once anyway

import fs from "node:fs";
import { filter, ruleToRgb } from "./filter.mjs";

const CONTRAST = 4.5;
const DELTAE = 3;

function process(theme) {
	const css = fs.readFileSync(`./themes/${theme}.css`, "utf8");
	const res = filter(css, CONTRAST, DELTAE);

	const toCoords = (rule) => `(${ruleToRgb(rule)})`;

	console.log(`${theme} - (${res.avgBg.map((v) => v.toFixed())})`);
	const original = [...new Set(res.original.map(toCoords))].join(",");
	fs.writeFileSync(`./desmos/original_${theme}.txt`, original, { flag: "w+" });
	const filtered = res.filtered.map(toCoords).join(",");
	fs.writeFileSync(`./desmos/filtered_${theme}.txt`, filtered, { flag: "w+" });

	return Object.fromEntries(
		res.filtered.map((rule) => {
			const [key, hex] = rule.split(":");
			return [key.slice(9).replace("-", "."), hex];
		}),
	);
}

const json = {
	Dark: process("dark"),
	Light: process("light"),
	HighContrast: process("darkhc"),
	HighContrastLight: process("lighthc"),
};
fs.writeFileSync(`./vscode-colors.json`, JSON.stringify(json), { flag: "w+" });
