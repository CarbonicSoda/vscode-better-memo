export namespace Aux.math {
	/**
	 * Returns a random integer within the ranges
	 * @returns integer within [min, max)
	 */
	export const randInt = (min: number, max: number) => Math.trunc(Math.random() * (max - min) + min);

	export const sum = (...numbers: number[]) => numbers.reduce((sum, n) => sum + n);
}

export namespace Aux.array {
	/**
	 * Implementation of Python's range()
	 */
	export function range(n: number): Iterable<number> {
		return Array(n).keys();
	}

	export function removeFrom<T>(array: T[], ...items: T[]): T[] {
		return array.filter((item) => !items.some((_item) => _item === item));
	}
}

export namespace Aux.object {
	/**
	 * Groups objects according to object[grouper] values
	 * @param objects iterable of objects
	 * @param grouper key of objects used to group them
	 * @returns different values of object[grouper] as keys and their corresponding objects[] as values
	 */
	export function group(objects: { [key: string]: any }[], grouper: string): { [group: string]: typeof objects } {
		const groups: { [group: string]: typeof objects } = {};
		for (const object of objects) groups[object[grouper]] = [];
		for (const object of objects) groups[object[grouper]].push(object);
		return groups;
	}
}

export namespace Aux.async {
	/**
	 * Sugar for the async for loop Promise.all(iterable.map(async (ele) => {...}))
	 */
	export async function map<T, C>(
		iterable: Iterable<T>,
		callback: (value: T, index: number, array: T[]) => Promise<C>,
	): Promise<Awaited<C>[]> {
		return await Promise.all([...iterable].map(callback));
	}

	/**
	 * Sugar for the async for loop Promise.all((await range(n)).map(async (i) => {...}))
	 */
	export async function range<T>(n: number, callback: (i: number) => Promise<T>): Promise<Awaited<T>[]> {
		return await map(array.range(n), callback);
	}
}

export namespace Aux.re {
	/**
	 * Makes a raw string valid for RegExp() without conflicts
	 * @param str raw RE string to escape
	 * @returns escaped RE for RegExp()
	 * @example "[(1+1)-2]*3" becomes "\[\(1\+1\)\-2\]\*3"
	 */
	export const escape = (str: string) => str.replace(/[[\]*+?{}.()^$|/\\-]/g, "\\$&");

	/**
	 * Concats several regular expressions into a union RegExp
	 */
	export const union = (...regExps: string[]) => RegExp(`(?:${regExps.join(")|(?:")})`);
}

export namespace Aux.string {
	/**
	 * @param countable number or iterable
	 * @returns "s" if countable is plural or else ""
	 */
	export const plural = (countable: number | any[]) =>
		((<{ length?: number }>countable).length ?? countable) === 1 ? "" : "s";
}

export namespace Aux.algorithm {
	/**
	 * Returns index of the latest element in array <= candid.
	 * If sorted[0] > candid, returns -1.
	 * If sorted.length === 0, returns undefined.
	 * @param transform optional function that returns a number for comparing if T is not number
	 */
	export function predecessorSearch<T>(
		sorted: T[],
		candid: number,
		transform: (ele: T) => number = (ele) => Number(ele),
	): number | undefined {
		if (sorted.length === 0) return undefined;

		const firstEle = transform(sorted[0]);
		const lastEle = transform(sorted.at(-1));
		if (firstEle > candid) return -1;
		if (firstEle === candid) return 0;
		if (candid >= lastEle) return sorted.length - 1;

		let left = 0;
		let right = sorted.length - 1;
		while (true) {
			const mid = Math.trunc((left + right) / 2);
			const midEle = transform(sorted[mid]);
			if (candid >= midEle) {
				const nextEle = transform(sorted[mid + 1]);
				if (nextEle > candid) return mid;
				left = mid + 1;
				continue;
			}
			right = mid;
		}
	}
}
