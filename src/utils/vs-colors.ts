import { ColorThemeKind, ThemeColor, window } from "vscode";
import { Aux } from "./auxiliary";

import VSCodeColors from "../json/vscode-colors.json";

export namespace VSColors {
	export type RGB3 = [r: number, g: number, b: number];

	/**
	 * Returns the closest ThemeColor to RGB or HEX, interpolated with sRGB color space
	 *
	 * The color would differ slightly within color themes of the same kind (dark/light/hc_dark/hc_light).
	 * Under different theme kinds the result would differ significantly for higher contrast.
	 * A demo of original & filtered colors could be seen at https://www.desmos.com/3d/wt60c3p2mk.
	 *
	 * Colors are based upon default vscode color themes, so custom color themes might lead to deviations in color
	 * or completely lacks contrast. If a color is found to be contrast-less in many themes, FILE AN ISSUE.
	 *
	 * @param rgbOrHex [R, G, B] or "#rrggbb", "#rgb" (case insensitive, # could be omitted)
	 */
	export function interpolate(rgbOrHex: RGB3 | string): ThemeColor {
		const rgb = typeof rgbOrHex === "string" ? HEX2RGB(rgbOrHex) : rgbOrHex;
		const colorThemeKind = ColorThemeKind[window.activeColorTheme.kind];
		let bestDist = 999999;
		let best = "";
		for (const [colorName, colorRgb] of Object.entries(VSCodeColors[<keyof typeof VSCodeColors>colorThemeKind])) {
			let dist = 0;
			for (let i = 0; i < 3; i++) dist += (rgb[i] - colorRgb[i]) ** 2;
			if (dist < bestDist) {
				bestDist = dist;
				best = colorName;
			}
		}
		return new ThemeColor(best);
	}

	/**
	 * Gets random RGB and then interpolates to get ThemeColor
	 */
	export function randomColor(): ThemeColor {
		const rgb = [Aux.math.randInt(0, 256), Aux.math.randInt(0, 256), Aux.math.randInt(0, 256)];
		return interpolate(<RGB3>rgb);
	}

	/**
	 * Returns a ThemeColor for the string which will not change over sessions or devices, like a hash function
	 */
	export function hashColor(hashString: string): ThemeColor {
		const rgb = sRGBHash(hashString);
		return interpolate(rgb);
	}

	/**
	 * Converts HEX to RGB
	 * @param hex "#rrggbb", "#rgb" (case insensitive, # could be omitted)
	 */
	export function HEX2RGB(hex: string): RGB3 {
		hex = hex.replace("#", "");
		if (hex.length === 3) hex = hex[0].repeat(2) + hex[1].repeat(2) + hex[2].repeat(2);
		return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
	}

	/**
	 * Returns a definite rgb for the string, just like a hash function
	 *
	 * Hash function from https://github.com/RolandR/ColorHash,
	 * modified to make permutations of characters be treated differently
	 */
	export function sRGBHash(hashString: string): RGB3 {
		let sum = 0;
		for (let i = 0; i < hashString.length; i++) sum += hashString.charCodeAt(i) * (i + 1);
		const getVal = (param: number) => Math.trunc(Number(`0.${String(Math.sin(sum + param)).slice(6)}`) * 256);
		return [getVal(1), getVal(2), getVal(3)];
	}
}
