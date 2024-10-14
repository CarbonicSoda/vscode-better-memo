export namespace Janitor {
	export type DisposableLike = {
		[any: string]: any;
		dispose(...args: any): any;
	};

	const managed: (DisposableLike | NodeJS.Timeout)[][] = [];
	let instancesID = 0;

	/**
	 * @param DisposableOrTimeout instances to manage
	 * @returns unique id for managed instance
	 */
	export function add(...DisposableOrTimeout: (DisposableLike | NodeJS.Timeout)[]): number {
		managed.push(DisposableOrTimeout);
		return instancesID++;
	}

	/**
	 * Clears the original managed instance and replaces with a new one
	 * @param id unique id of managed instance to override
	 * @param DisposableOrTimeout instances to manage instead
	 */
	export function override(id: number, ...DisposableOrTimeout: (DisposableLike | NodeJS.Timeout)[]): void {
		if (managed[id].length === 0) throw new Error(`No managed instance to override with id ${id}`);
		clear(id);
		managed[id] = DisposableOrTimeout;
	}

	/**
	 * @param id unique id of managed instance
	 */
	export function clear(id: number): void {
		if (!managed[id] || managed[id].length === 0) return;
		for (const instance of managed[id]) {
			if ((<{ dispose?: (...args: any) => any }>instance).dispose) {
				(<{ dispose: (...args: any) => any }>instance).dispose();
				continue;
			}
			clearTimeout(<NodeJS.Timeout>instance);
		}
		managed[id] = [];
	}

	/**
	 * Clears all managed instances
	 */
	export function cleanUp(): void {
		for (let i = 0; i < instancesID; i++) clear(i);
	}
}
