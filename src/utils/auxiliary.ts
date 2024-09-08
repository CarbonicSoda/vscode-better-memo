export namespace Aux {
	/**
	 * Implementation of Python's range()
	 */
	export async function range(n: number): Promise<Iterable<number>> {
		return Array(n).keys();
	}

	/**
	 * Sugar for the async for loop Promise.all(iterable.map(async (ele) => {...}))
	 */
	export async function asyncFor<T, C>(
		iterable: Iterable<T>,
		callback: (value: T, index: number, array: T[]) => Promise<C>,
	): Promise<Awaited<C>[]> {
		return await Promise.all([...iterable].map(callback));
	}

	/**
	 * Sugar for the async for loop Promise.all((await range(n)).map(async (i) => {...}))
	 */
	export async function asyncRange<T>(n: number, callback: (i: number) => Promise<T>): Promise<Awaited<T>[]> {
		return await asyncFor(await range(n), callback);
	}

	/**
	 * Array.includes() for objects
	 */
	export async function objectsInclude(objects: Object[], object: Object): Promise<boolean> {
		return (await Aux.asyncFor(objects, async (obj) => JSON.stringify(obj)))
			.join("\n")
			.includes(JSON.stringify(object));
	}

	/**
	 * Array.indexOf() for objects
	 */
	export async function objectsIndexOf(objects: Object[], object: Object): Promise<number> {
		return (await Aux.asyncFor(objects, async (obj) => JSON.stringify(obj))).indexOf(JSON.stringify(object));
	}

	/**
	 * Groups objects according to object[grouper] values
	 * @param objects iterable of objects
	 * @param grouper key of objects used to group them
	 * @returns different values of object[grouper] as keys and their corresponding objects[] as values
	 */
	export async function groupObjects(
		objects: { [key: string]: any }[],
		grouper: string,
	): Promise<{ [group: string]: { [key: string]: any }[] }> {
		const groups: { [group: string]: { [key: string]: any }[] } = {};
		await asyncFor(objects, async (object) => {
			groups[object[grouper]] = [];
		});
		await asyncFor(objects, async (object) => {
			groups[object[grouper]].push(object);
		});
		return groups;
	}

	/**
	 * @param countable number or iterable
	 * @returns "s" if countable is plural or else ""
	 */
	export const plural = async (countable: number | any[]) =>
		((<{ length: number }>countable).length ?? countable) === 1 ? "" : "s";

	/**
	 * Makes a raw string valid for RegExp() without conflicts
	 * @param str raw RE string to escape
	 * @returns escaped RE for RegExp()
	 * @example "[(1+1)-2]*3" becomes "\[\(1\+1\)\-2\]\*3"
	 */
	export const reEscape = async (str: string) => str.replace(/[[\]*+?{}.()^$|/\\-]/g, "\\$&");

	/**
	 * Returns a random integer within the ranges
	 * @returns integer within [min, max] (!!includes max)
	 */
	export const randInt = async (min: number, max: number) => Math.round(Math.random() * (max - min) + min);

	/**
	 * math.clamp(), fits x into [min, max]
	 */
	export async function clamp(x: number, min: number, max: number): Promise<number> {
		if (x < min) return min;
		if (x > max) return max;
		return x;
	}

	/**
	 * Implementation of Promise.props()
	 * @param object object with properties to resolve
	 */
	export async function promiseProps<T>(object: {
		[key: string | number | symbol]: T;
	}): Promise<{ [key: string | number | symbol]: Awaited<T> }> {
		const values = await Promise.all(Object.values(object));
		const keys = Object.keys(object);
		await asyncRange(keys.length, async (i) => {
			object[keys[i]] = values[i];
		});
		return <{ [key: string | number | symbol]: Awaited<T> }>object;
	}

	/**
	 * Returns index of the latest element in array <= candid. If sorted[0] > candid, returns -1
	 * @param transform optional function that returns a number for comparing if T is not number
	 */
	export async function binaryMinSearch<T>(
		sorted: T[],
		candid: T,
		transform: (a: T) => number | Promise<number> = async (a) => Number(a),
	): Promise<number> {
		const _candid = await transform(candid);
		const firstEle = await transform(sorted[0]);
		const lastEle = await transform(sorted.at(-1));
		if (firstEle > _candid) return -1;
		if (firstEle === _candid) return 0;
		if (_candid >= lastEle) return sorted.length - 1;

		let left = 0;
		let right = sorted.length - 1;
		while (true) {
			const mid = Math.trunc((left + right) / 2);
			const midEle = await transform(sorted[mid]);
			if (_candid >= midEle) {
				const nextEle = await transform(sorted[mid + 1]);
				if (nextEle > _candid) return mid;
				left = mid + 1;
				continue;
			}
			right = mid;
		}
	}
}
