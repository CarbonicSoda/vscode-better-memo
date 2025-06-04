export namespace Aux.object {
	/**
	 * Similar to Object.groupBy()
	 *
	 * @param grouper callback for group keys
	 * @returns ``grouper(obj)` as keys and corresponding objects as values
	 */
	export function group<O extends { [key: string]: any }, V>(
		objs: O[],
		grouper: (obj: O, i: number) => V,
	): Map<V, O[]> {
		const groups: Map<V, O[]> = new Map();

		objs.forEach((obj, i) => {
			const group =
				typeof grouper === "function"
					? grouper(obj, i)
					: obj[grouper as keyof O];

			if (!groups.has(group)) groups.set(group, []);
			groups.get(group)!.push(obj);
		});

		return groups;
	}
}

export namespace Aux.async {
	export async function map<T, C>(
		iterable: Iterable<T>,
		callback: (value: T, index: number, array: T[]) => Promise<C>,
	): Promise<Awaited<C>[]> {
		return await Promise.all(Array.from(iterable).map(callback));
	}
}

export namespace Aux.re {
	/**
	 * Makes a raw string valid for `RegExp()` without conflicts
	 * @example "[(1+1)-2]*3" becomes "\[\(1\+1\)\-2\]\*3"
	 */
	export const escape = (str: string) => {
		return str.replace(/[[\]*+?{}.()^$|/\\-]/g, "\\$&");
	};
}

export namespace Aux.string {
	/**
	 * @param countable number or object with `.length` property
	 * @returns "s" if countable is plural or else ""
	 */
	export const plural = (countable: number | any[]) => {
		return (typeof countable === "number" ? countable : countable.length) === 1
			? ""
			: "s";
	};
}

export namespace Aux.algorithm {
	/**
	 * @returns index of the last element in `sorted` <= `candid`
	 *
	 * - If `sorted`[0] > `candid`, returns -1;
	 * - If `sorted`.length === 0, returns undefined;
	 *
	 * @param transform optional function that returns T for comparison
	 * @param compare optional function that returns a number for comparison if T is not number
	 */
	export function predecessorSearch<O, T>(
		candid: T,
		array: O[],
		transform: (a: O) => T = (a) => a as unknown as T,
		compare: (a: T, b: T) => number = (a, b) => +a - +b,
	): number | undefined {
		if (array.length === 0) return undefined;

		const sorted = array.map(transform).sort(compare);

		const boundsLeft = compare(sorted[0], candid);
		const boundsRight = compare(candid, sorted.at(-1)!);

		if (boundsLeft === 0) return 0;

		if (boundsLeft > 0) return -1;
		if (boundsRight > 0) return sorted.length - 1;

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
