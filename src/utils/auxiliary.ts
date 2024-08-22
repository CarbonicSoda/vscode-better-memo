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
	export const reEscape = (str?: string) => str?.replace(/[[\]*+?{}.()^$|/\\-]/g, "\\$&");

	/**
	 * Returns a random integer within the ranges
	 * @returns integer within [min, max] (!!includes max)
	 */
	export const randInt = (min: number, max: number) => Math.round(Math.random() * (max - min) + min);
}
