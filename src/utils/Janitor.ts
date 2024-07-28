export class Janitor {
	/**
	 * @param DisposableOrTimeout instances to manage
	 * @returns unique id for Janitor.clear()
	 */
	add(...DisposableOrTimeout: (DisposableLike | NodeJS.Timeout)[]) {
		this.managed[this.id] = DisposableOrTimeout;
		return this.id++;
	}
	/**
	 * @param id unique id of managed instances for clearing
	 */
	clear(id: number) {
		for (const instance of this.managed[id] ?? []) {
			// @ts-ignore
			instance.dispose?.();
			try {
				//@ts-ignore
				clearTimeout(instance);
			} finally {
			}
		}
	}
	/**
	 * clears all managed instances
	 */
	clearAll() {
		for (const id of Object.keys(this.managed)) this.clear(Number(id));
	}
	/**
	 * Clears the original managed instance and manages a new one
	 * @param id unique id of managed instance to override
	 * @param DisposableOrTimeout instances to manage instead
	 */
	override(id: number, ...DisposableOrTimeout: (DisposableLike | NodeJS.Timeout)[]) {
		if (!Object.hasOwn(this.managed, id)) throw new Error(`No managed instance to override with id ${id}`);
		this.clear(id);
		this.managed[id] = DisposableOrTimeout;
	}

	private managed: (DisposableLike | NodeJS.Timeout)[][] = [];
	private id = 0;
}
type DisposableLike = {
	[any: string]: any;
	dispose(...args: any): void;
};
