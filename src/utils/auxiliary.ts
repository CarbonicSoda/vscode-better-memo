export namespace Aux {
	export function groupObjects(
		arrayOrIterable: { [key: string]: any }[],
		grouper: string,
	): { [group: string]: { [key: string]: any }[] } {
		const groups: { [group: string]: { [key: string]: any }[] } = {};
		for (const object of arrayOrIterable) {
			if (!groups[object[grouper]]) groups[object[grouper]] = [];

			groups[object[grouper]].push(object);
		}
		return groups;
	}

	export const plural = (countable: number | any[]) =>
		((<{ length: number }>countable).length ?? countable) === 1 ? "" : "s";

	export const reEscape = (str?: string) => str?.replace(/[[\]*+?{}.()^$|/\\-]/g, "\\$&");
}
