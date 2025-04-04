import { ColorThemeKind, ThemeColor, window } from "vscode";

import VSCodeColors from "../json/vscode-colors.json";

/**
 * Functions to return {@link ThemeColor} from sRGB or string-hash
 */
export namespace VSColors {
	const VSCodeColorsRgb: {
		[themeKind: string]: { [colorName: string]: RGB3 };
	} = {};
	for (const [themeKind, colors] of Object.entries(VSCodeColors)) {
		VSCodeColorsRgb[themeKind] = {};
		for (const [colorName, hex] of Object.entries(colors)) {
			VSCodeColorsRgb[themeKind][colorName] = hexToRgb(hex);
		}
	}

	/**
	 * RGB entry
	 */
	export type RGB3 = [R: number, G: number, B: number];

	/**
	 * @returns the closest {@link ThemeColor} to `rgbOrHex`, interpolated in RGB color space with DeltaE
	 *
	 * The colors would differ slightly within color themes of the same {@link ColorThemeKind} `(dark/light/hc_dark/hc_light)`,
	 * under different theme kinds the result would differ significantly, **INTENDED** for higher contrast
	 *
	 * A demo of original & filtered colors could be seen at https://www.desmos.com/3d/wf8kxmcols
	 *
	 * @param RGBorHEX `RGB3`: [R, G, B], `"#rrggbb"` or `"#rgb"` (case insensitive, "#" could be omitted)
	 */
	export function interpolate(RGBorHEX: RGB3 | string): ThemeColor {
		const rgb = typeof RGBorHEX === "string" ? hexToRgb(RGBorHEX) : RGBorHEX;
		const colorThemeKind = ColorThemeKind[window.activeColorTheme.kind];
		let bestDeltaE = Infinity;
		let best = "";
		for (const [colorName, colorRgb] of Object.entries(
			VSCodeColorsRgb[<keyof typeof VSCodeColorsRgb>colorThemeKind],
		)) {
			const deltaE = getDeltaE(rgb, colorRgb);
			if (deltaE < bestDeltaE) {
				bestDeltaE = deltaE;
				best = colorName;
			}
		}
		return new ThemeColor(best);
	}

	/**
	 * @returns a {@link ThemeColor} for `hashString` which will not change over sessions or devices
	 *
	 * Since colors are limited to the higher-constrast sRGB half-cube,
	 * colors hashed to the other half-cube might be interpolated to very similar colors,
	 * and I'm too dumb ~~lazy~~ to fix that
	 */
	export function hash(hashString: string): ThemeColor {
		const rgb = sRgbHash(hashString);
		return interpolate(rgb);
	}

	/**
	 * @returns a definite rgb for `hashString`, like a hash function
	 *
	 * Hash function is from https://github.com/RolandR/ColorHash
	 * modified to make permutations of characters to give different colors
	 */
	function sRgbHash(hashString: string): RGB3 {
		let sum = 0;
		for (let i = 0; i < hashString.length; i++) {
			sum += hashString.charCodeAt(i) * (i + 1);
		}
		const getVal = (param: number) =>
			Math.trunc(Number(`0.${String(Math.sin(sum + param)).slice(6)}`) * 256);
		return [getVal(1), getVal(2), getVal(3)];
	}

	/**
	 * Converts `hex` to `RGB3`
	 * @param hex `"#rrggbb"` or `"#rgb"` (case insensitive, "#" could be omitted)
	 */
	function hexToRgb(hex: string): RGB3 {
		hex = hex.replace("#", "");
		if (hex.length === 3) {
			hex = hex[0].repeat(2) + hex[1].repeat(2) + hex[2].repeat(2);
		}
		return [
			parseInt(hex.slice(0, 2), 16),
			parseInt(hex.slice(2, 4), 16),
			parseInt(hex.slice(4, 6), 16),
		];
	}

	// from https://stackoverflow.com/q/54738431
	function getDeltaE(rgb1: RGB3, rgb2: RGB3): number {
		const labA = rgbToLab(rgb1);
		const labB = rgbToLab(rgb2);

		const deltaL = labA[0] - labB[0];
		const deltaA = labA[1] - labB[1];
		const deltaB = labA[2] - labB[2];
		const c1 = Math.sqrt(labA[1] * labA[1] + labA[2] * labA[2]);
		const c2 = Math.sqrt(labB[1] * labB[1] + labB[2] * labB[2]);
		const deltaC = c1 - c2;
		let deltaH = deltaA * deltaA + deltaB * deltaB - deltaC * deltaC;
		deltaH = deltaH < 0 ? 0 : Math.sqrt(deltaH);
		const sc = 1.0 + 0.045 * c1;
		const sh = 1.0 + 0.015 * c1;
		const deltaLKlsl = deltaL / 1.0;
		const deltaCkcsc = deltaC / sc;
		const deltaHkhsh = deltaH / sh;
		const i =
			deltaLKlsl * deltaLKlsl +
			deltaCkcsc * deltaCkcsc +
			deltaHkhsh * deltaHkhsh;
		return i < 0 ? 0 : Math.sqrt(i);
	}

	function rgbToLab(rgb: RGB3): [number, number, number] {
		let r = rgb[0] / 255,
			g = rgb[1] / 255,
			b = rgb[2] / 255,
			x,
			y,
			z;
		r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
		g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
		b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
		x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
		y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.0;
		z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
		x = x > 0.008856 ? Math.pow(x, 1 / 3) : 7.787 * x + 16 / 116;
		y = y > 0.008856 ? Math.pow(y, 1 / 3) : 7.787 * y + 16 / 116;
		z = z > 0.008856 ? Math.pow(z, 1 / 3) : 7.787 * z + 16 / 116;
		return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
	}
}
