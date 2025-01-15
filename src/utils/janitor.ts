/**
 * Centrally manages disposable(-like)s and timeouts/intervals
 */
export namespace Janitor {
	/**
	 * Alias for number returned from Janitor for better context
	 */
	export type Id = number;

	/**
	 * Type with `dispose()` function signature
	 */
	export type DisposableLike = {
		[any: string]: any;
		dispose(...args: any): any;
	};

	const managed: (DisposableLike | NodeJS.Timeout)[][] = [];
	let instancesID = 0;

	/**
	 * @param DisposableOrTimeout instances to manage
	 * @returns unique id for `DisposableOrTimeout`
	 */
	export function add(...DisposableOrTimeout: (DisposableLike | NodeJS.Timeout)[]): Id {
		managed.push(DisposableOrTimeout);
		return instancesID++;
	}

	/**
	 * Disposes/Clears the original managed instances with `id` and replaces it with `DisposableOrTimeout[]`
	 */
	export function override(id: Id, ...DisposableOrTimeout: (DisposableLike | NodeJS.Timeout)[]): void {
		if (managed[id].length === 0) throw new Error(`No managed instance to override with id ${id}`);
		clear(id);
		managed[id] = DisposableOrTimeout;
	}

	/**
	 * Disposes/Clears the managed instances with `id`
	 */
	export function clear(id: Id): void {
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
	 * Disposes/Clears all currently managed instances
	 */
	export function cleanUp(): void {
		for (let i = 0; i < instancesID; i++) clear(i);
	}
}
