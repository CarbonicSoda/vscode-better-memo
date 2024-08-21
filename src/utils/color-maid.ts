import { ThemeColor } from "vscode";
import VscodeColors from "../vscode-colors.json";

type RGB3 = [number, number, number];

export function getColorMaid(): typeof ColorMaid {
	return ColorMaid;
}

const ColorMaid: {
	interpolate(rgbOrHex: RGB3 | string): ThemeColor;

	randomColor(): ThemeColor;

	hashColor(hashString: string): ThemeColor;

	hex2rgb(hex: string): RGB3;
} = {
	interpolate(rgbOrHex: RGB3 | string): ThemeColor {
		const rgb = typeof rgbOrHex === "string" ? this.hex2rgb(rgbOrHex) : rgbOrHex;
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
		return new ThemeColor(best);
	},

	randomColor(): ThemeColor {
		const rgb = [randInt(0, 255), randInt(0, 255), randInt(0, 255)];
		return this.interpolate(<RGB3>rgb);
	},

	hashColor(hashString: string): ThemeColor {
		const rgb = colorHash(hashString);
		return this.interpolate(<RGB3>rgb);
	},

	hex2rgb(hex: string): RGB3 {
		hex = hex.replace("#", "");
		return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
	},
};

const randInt = (min: number, max: number) => Math.round(Math.random() * (max - min) + min);

// Hash function from https://github.com/RolandR/ColorHash, modified to make permutations of characters be treated differently etc
function colorHash(hashString: string): RGB3 {
	let sum = 0;
	for (let i = 0; i < hashString.length; i++) sum += hashString.charCodeAt(i) * (i + 1);
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
