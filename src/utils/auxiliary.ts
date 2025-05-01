/**
 * Array related functions
 */
export namespace Aux.array {
	/**
	 * @returns copy of `array` with `items` removed (all duplicates of `items` are also removed)
	 */
	export function removeFrom<T>(array: T[], ...items: T[]): T[] {
		return array.filter((item) => !items.includes(item));
	}
}

/**
 * Asynchronous operation functions
 */
export namespace Aux.async {
	/**
	 * Sugar for Promise.all(`iterable`.map(`async (ele) => {...}`))
	 */
	export async function map<T, C>(
		iterable: Iterable<T>,
		callback: (value: T, index: number, array: T[]) => Promise<C>,
	): Promise<Awaited<C>[]> {
		return await Promise.all([...iterable].map(callback));
	}
}

/**
 * RegExp related functions
 */
export namespace Aux.re {
	/**
	 * Makes a raw string valid for `RegExp()` without conflicts
	 * @example "[(1+1)-2]*3" becomes "\[\(1\+1\)\-2\]\*3"
	 */
	export const escape = (str: string) => {
		return str.replace(/[[\]*+?{}.()^$|/\\-]/g, "\\$&");
	};
}

/**
 * String related functions
 */
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

/**
 * Useful algorithms
 */
export namespace Aux.algorithm {
	/**
	 * @returns index of the latest element in `sorted` <= `candid`
	 *
	 * - If `sorted`[0] > `candid`, returns -1;
	 * - If `sorted`.length === 0, returns undefined;
	 *
	 * @param transform optional function that returns a number for comparison if T is not number
	 */
	export function predecessorSearch<T>(
		sorted: T[],
		candid: number,
		transform: (ele: T) => number = (ele) => Number(ele),
	): number | undefined {
		if (sorted.length === 0) return undefined;

		const firstEle = transform(sorted[0]);
		const lastEle = transform(sorted.at(-1)!);

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
