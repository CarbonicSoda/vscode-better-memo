import { ColorThemeKind, ThemeColor, window } from "vscode";
import { Aux } from "./auxiliary";

import VScodeColors from "../vscode-colors.json";

type RGB3 = [number, number, number];

export function getColorMaid(): typeof ColorMaid {
	return ColorMaid;
}

const ColorMaid: {
	/**
	 * Returns the closest ThemeColor to param, interpolated using RGB color space.
	 * Also, under different color themes the result might differ significantly (though still the closest match).
	 * This is intended for higher contrast.
	 * A demo of original & filtered colors could be seen at https://www.desmos.com/3d/wt60c3p2mk
	 * @param rgbOrHex [R, G, B] or "#rrggbb", "#rgb" (case insensitive, # could be omitted)
	 */
	interpolate(rgbOrHex: RGB3 | string): ThemeColor;

	/**
	 * Gets random RGB and then interpolates to get ThemeColor
	 */
	randomColor(): ThemeColor;

	/**
	 * Returns a ThemeColor for a string which will not change over sessions or devices, like a hash code
	 */
	hashColor(hashString: string): ThemeColor;

	/**
	 * Converts HEX to RGB
	 * @param hex "#rrggbb", "#rgb" (case insensitive, # could be omitted)
	 */
	hex2rgb(hex: string): RGB3;
} = {
	interpolate(rgbOrHex: RGB3 | string): ThemeColor {
		const rgb = typeof rgbOrHex === "string" ? this.hex2rgb(rgbOrHex) : rgbOrHex;
		const colorThemeKind = ColorThemeKind[window.activeColorTheme.kind];
		let bestDist = 999999;
		let best = "";
		for (const [colorName, colorRgb] of Object.entries(VScodeColors[<keyof typeof VScodeColors>colorThemeKind])) {
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
		const rgb = [Aux.randInt(0, 255), Aux.randInt(0, 255), Aux.randInt(0, 255)];
		return this.interpolate(<RGB3>rgb);
	},

	hashColor(hashString: string): ThemeColor {
		const rgb = colorHash(hashString);
		return this.interpolate(<RGB3>rgb);
	},

	hex2rgb(hex: string): RGB3 {
		hex = hex.replace("#", "");
		if (hex.length === 3) hex = hex[0].repeat(2) + hex[1].repeat(2) + hex[2].repeat(2);
		return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
	},
};

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
