export default class Janitor {
	/**
	 * @param DisposableOrTimeout instances to manage
	 * @returns unique id for Janitor.clear()
	 */
	add(...DisposableOrTimeout: (DisposableLike | NodeJS.Timeout)[]) {
		this._managed[this._id] = DisposableOrTimeout;
		return this._id++;
	}
	/**
	 * @param id unique id of managed instances for clearing
	 */
	clear(id: number) {
		for (const instance of this._managed[id] ?? []) {
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
		for (const id of Object.keys(this._managed)) this.clear(Number(id));
	}
	/**
	 * Clears the original managed instance and manages a new one
	 * @param id unique id of managed instance to override
	 * @param DisposableOrTimeout instances to manage instead
	 */
	override(id: number, ...DisposableOrTimeout: (DisposableLike | NodeJS.Timeout)[]) {
		if (!Object.hasOwn(this._managed, id)) throw new Error(`No managed instance to override with id ${id}`);
		this.clear(id);
		this._managed[id] = DisposableOrTimeout;
	}

	private _managed: (DisposableLike | NodeJS.Timeout)[][] = [];
	private _id = 0;
}
type DisposableLike = {
	[any: string]: any;
	dispose(...args: any): void;
};
