import { ColorThemeKind, ThemeColor, window } from "vscode";
import { Aux } from "./auxiliary";

import VScodeColors from "../json/vscode-colors.json";

type RGB3 = [r: number, g: number, b: number];

export type ColorMaid = typeof ColorMaid;

export async function getColorMaid(): Promise<typeof ColorMaid> {
	return ColorMaid;
}

const ColorMaid: {
	/**
	 * Returns the closest ThemeColor to RGB or HEX, interpolated with sRGB color space
	 *
	 * The color would differ slightly within color themes of the same kind (dark/light/hc_dark/hc_light).
	 * Under different theme kinds the result would differ significantly for higher contrast.
	 * A demo of original & filtered colors could be seen at https://www.desmos.com/3d/wt60c3p2mk
	 *
	 * @param rgbOrHex [R, G, B] or "#rrggbb", "#rgb" (case insensitive, # could be omitted)
	 */
	interpolate(rgbOrHex: RGB3 | string): Promise<ThemeColor>;

	/**
	 * Gets random RGB and then interpolates to get ThemeColor
	 */
	randomColor(): Promise<ThemeColor>;

	/**
	 * Returns a ThemeColor for the string which will not change over sessions or devices, like a hash function
	 */
	hashColor(hashString: string): Promise<ThemeColor>;

	/**
	 * Converts HEX to RGB
	 * @param hex "#rrggbb", "#rgb" (case insensitive, # could be omitted)
	 */
	HEX2RGB(hex: string): Promise<RGB3>;

	/**
	 * Returns a definite rgb for the string, just like a hash function
	 *
	 * Hash function from https://github.com/RolandR/ColorHash
	 *
	 * Modified to make permutations of characters be treated differently
	 */
	sRGBHash(hashString: string): Promise<RGB3>;
} = {
	async interpolate(rgbOrHex: RGB3 | string): Promise<ThemeColor> {
		const rgb = typeof rgbOrHex === "string" ? await this.HEX2RGB(rgbOrHex) : rgbOrHex;
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

	async randomColor(): Promise<ThemeColor> {
		const rgb = await Promise.all([Aux.randInt(0, 255), Aux.randInt(0, 255), Aux.randInt(0, 255)]);
		return await this.interpolate(<RGB3>rgb);
	},

	async hashColor(hashString: string): Promise<ThemeColor> {
		const rgb = await this.sRGBHash(hashString);
		return await this.interpolate(<RGB3>rgb);
	},

	async HEX2RGB(hex: string): Promise<RGB3> {
		hex = hex.replace("#", "");
		if (hex.length === 3) hex = hex[0].repeat(2) + hex[1].repeat(2) + hex[2].repeat(2);
		return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
	},

	async sRGBHash(hashString: string): Promise<RGB3> {
		let sum = 0;
		for (let i = 0; i < hashString.length; i++) sum += hashString.charCodeAt(i) * (i + 1);
		const getVal = async (param: number) =>
			Math.trunc(
				Number(
					`0.${Math.sin(sum + param)
						.toString()
						.slice(6)}`,
				) * 256,
			);
		return await Promise.all([getVal(1), getVal(2), getVal(3)]);
	},
};
