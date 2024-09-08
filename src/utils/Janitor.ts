import { Aux } from "./auxiliary";

export type DisposableLike = {
	[any: string]: any;
	dispose(...args: any): any;
};

export class Janitor {
	private managed: (DisposableLike | NodeJS.Timeout)[][] = [];
	private autoIncrementInstanceID = 0;

	/**
	 * @param DisposableOrTimeout instances to manage
	 * @returns unique id for managed instance
	 */
	async add(
		...DisposableOrTimeout: (DisposableLike | Promise<DisposableLike> | NodeJS.Timeout | Promise<NodeJS.Timeout>)[]
	): Promise<number> {
		this.managed.push(await Promise.all(DisposableOrTimeout));
		return this.autoIncrementInstanceID++;
	}

	/**
	 * @param id unique id of managed instance
	 */
	async clear(id: number): Promise<void> {
		if (this.managed[id]?.length === 0) return;
		await Aux.asyncFor(this.managed[id], async (instance) => {
			(<{ dispose?: (...args: any) => any }>instance).dispose?.();
			try {
				clearTimeout(<NodeJS.Timeout>instance);
			} finally {
			}
		});
		this.managed[id] = [];
	}

	/**
	 * Clears all managed instances
	 */
	async clearAll(): Promise<void> {
		await Aux.asyncRange(this.autoIncrementInstanceID, async (i) => await this.clear(i));
	}

	/**
	 * Clears the original managed instance and replaces with a new one
	 * @param id unique id of managed instance to override
	 * @param DisposableOrTimeout instances to manage instead
	 */
	async override(
		id: number,
		...DisposableOrTimeout: (DisposableLike | Promise<DisposableLike> | NodeJS.Timeout | Promise<NodeJS.Timeout>)[]
	): Promise<void> {
		if (this.managed[id].length === 0) throw new Error(`No managed instance to override with id ${id}`);
		await this.clear(id);
		this.managed[id] = await Promise.all(DisposableOrTimeout);
	}

	async dispose() {
		await this.clearAll();
	}
}
