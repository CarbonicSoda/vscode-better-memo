import * as vscode from "vscode";
import VscodeColors from "../vscode-colors.json";

export function getColorMaid() {
	return ColorMaid;
}
const ColorMaid: {
	interpolate(rgb: RGB3): vscode.ThemeColor;
	randomColor(): vscode.ThemeColor;
	hashColor(hashString: string): vscode.ThemeColor;
} = {
	interpolate(rgb) {
		let bestDist = 999999;
		let best = "";
		for (const [colorName, colorRgb] of Object.entries(VscodeColors)) {
			let dist = 0;
			for (let i = 0; i < 3; i++) dist += (rgb[i] - colorRgb[i]) ** 2;
			if (dist < bestDist) {
				bestDist = dist;
				best = colorName;
			}
		}
		return new vscode.ThemeColor(best);
	},
	randomColor() {
		const rgb = [randInt(0, 255), randInt(0, 255), randInt(0, 255)];
		return this.interpolate(<RGB3>rgb);
	},
	hashColor(hashString) {
		const rgb = colorHash(hashString);
		return this.interpolate(<RGB3>rgb);
	},
};
type RGB3 = [number, number, number];

const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min) + min);
// Hash function modified from https://github.com/RolandR/ColorHash
function colorHash(hashString: string) {
	let sum = 0;
	for (let i = 0; i < hashString.length; i++) sum += hashString.charCodeAt(i);
	const getVal = (param: number) =>
		Math.floor(
			Number(
				"0." +
					Math.sin(sum + param)
						.toString()
						.slice(6),
			) * 256,
		);
	return [getVal(1), getVal(2), getVal(3)];
}
