export namespace Aux {
	/**
	 * Groups objects according to object[grouper] values
	 * @param objects iterable of objects
	 * @param grouper key of objects used to group them
	 * @returns different values of object[grouper] as keys and their corresponding objects[] as values
	 */
	export function groupObjects(
		objects: { [key: string]: any }[],
		grouper: string,
	): { [group: string]: { [key: string]: any }[] } {
		const groups: { [group: string]: { [key: string]: any }[] } = {};
		for (const object of objects) {
			if (!groups[object[grouper]]) groups[object[grouper]] = [];

			groups[object[grouper]].push(object);
		}
		return groups;
	}

	/**
	 * @param countable number or iterable
	 * @returns "s" if countable is plural or else ""
	 */
	export const plural = (countable: number | any[]) =>
		((<{ length: number }>countable).length ?? countable) === 1 ? "" : "s";

	/**
	 * Makes a raw string valid for RegExp() without conflicts
	 * @param str raw RE string to escape
	 * @returns escaped RE for RegExp()
	 * @example "[(1+1)-2]*3" becomes "\[\(1\+1\)\-2\]\*3"
	 */
	export const reEscape = (str: string) => str.replace(/[[\]*+?{}.()^$|/\\-]/g, "\\$&");

	/**
	 * Returns a random integer within the ranges
	 * @returns integer within [min, max] (!!includes max)
	 */
	export const randInt = (min: number, max: number) => Math.round(Math.random() * (max - min) + min);

	/**
	 * Returns index of the latest element in array <= candid. If sorted[0] > candid, returns -1
	 * @param compare optional compare function that returns a number > 0 if a is larger than b, < 0 if a is smaller than b, 0 if a === b
	 */
	export function binaryMinSearch<T>(
		sorted: T[],
		candid: T,
		compare: (a: T, b: T) => number = (a, b) => (a === b ? 0 : a > b ? 1 : -1),
	) {
		if (compare(sorted[0], candid) >= 0) return -1;
		if (compare(sorted[0], candid) === 0) return 0;
		if (compare(candid, sorted.at(-1)) >= 0) return sorted.length - 1;
		let left = 0;
		let right = sorted.length - 1;
		while (true) {
			const mid = Math.trunc((left + right) / 2);
			if (compare(candid, sorted[mid]) >= 0) {
				if (compare(sorted[mid + 1], candid) > 0) return mid;
				left = mid + 1;
				continue;
			}
			right = mid;
		}
	}
}
