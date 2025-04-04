// All code unoptimized, as they will only be ran once anyway

export function filter(src, contrast, deltaE) {
	const content = src.slice(19, -2).replaceAll(/\s+/g, "");
	const original = sortRules(
		content.split(";").filter((rule) => rule && !/:rgba/.test(rule)),
	);

	const editorBg = hex2rgb(
		content.match(/--vscode-editor-background:#(?<hex>.+?);/).groups.hex,
	);
	const sideBarBg = hex2rgb(
		content.match(/--vscode-sideBar-background:#(?<hex>.+?);/).groups.hex,
	);
	const avgBg = editorBg.map((v, i) =>
		Math.sqrt((v ** 2 + sideBarBg[i] ** 2) / 2),
	);

	let filtered = filterContrast(avgBg, original, contrast);
	filtered = filterDeltaE(filtered, deltaE);

	return {
		avgBg,
		original,
		filtered,
	};
}

function filterContrast(avgBg, rules, threshold = 4.5) {
	return rules.filter((rule) => {
		const rgb = ruleToRgb(rule);
		const contrast = getContrast(rgb, avgBg);
		return contrast > threshold;
	});
}

function filterDeltaE(rules, threshold = 3) {
	const filtered = [];
	for (const rule of sortRules(rules)) {
		let lowDiff = false;
		for (const _rule of filtered) {
			if (getDeltaE(ruleToRgb(rule), ruleToRgb(_rule)) < threshold) {
				lowDiff = true;
				break;
			}
		}
		if (!lowDiff) filtered.push(rule);
	}
	return filtered;
}

// from https://stackoverflow.com/a/9733420
const RED = 0.2126;
const GREEN = 0.7152;
const BLUE = 0.0722;
const GAMMA = 2.4;
function getLuminance(rgb) {
	const a = rgb.map((v) => {
		v /= 255;
		return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, GAMMA);
	});
	return a[0] * RED + a[1] * GREEN + a[2] * BLUE;
}
function getContrast(rgb1, rgb2) {
	const lum1 = getLuminance(rgb1);
	const lum2 = getLuminance(rgb2);
	const brightest = Math.max(lum1, lum2);
	const darkest = Math.min(lum1, lum2);
	return (brightest + 0.05) / (darkest + 0.05);
}

// from https://stackoverflow.com/q/54738431
function getDeltaE(rgb1, rgb2) {
	const labA = rgb2lab(rgb1);
	const labB = rgb2lab(rgb2);

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
		deltaLKlsl * deltaLKlsl + deltaCkcsc * deltaCkcsc + deltaHkhsh * deltaHkhsh;
	return i < 0 ? 0 : Math.sqrt(i);
}
function rgb2lab(rgb) {
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

export function ruleToRgb(rule) {
	return hex2rgb(rule.split(":#")[1]);
}
function hex2rgb(hex) {
	return [
		parseInt(hex.slice(0, 2), 16),
		parseInt(hex.slice(2, 4), 16),
		parseInt(hex.slice(4, 6), 16),
	];
}
function sortRules(rules) {
	return rules.sort((a, b) => a.split(":#")[1].localeCompare(b.split(":#")[1]));
}
