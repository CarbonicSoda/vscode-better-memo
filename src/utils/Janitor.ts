import { Aux } from "./auxiliary";

export type DisposableLike = {
	[any: string]: any;
	dispose(...args: any): any;
};

export type Janitor = typeof janitor;

export async function getJanitor(): Promise<Janitor> {
	return janitor;
}

export async function disposeJanitor(): Promise<void> {
	await janitor.clearAll();
}

const janitor: {
	/**
	 * @param DisposableOrTimeout instances to manage
	 * @returns unique id for managed instance
	 */
	add(
		...DisposableOrTimeout: (DisposableLike | Promise<DisposableLike> | NodeJS.Timeout | Promise<NodeJS.Timeout>)[]
	): Promise<number>;

	/**
	 * @param id unique id of managed instance
	 */
	clear(id: number): Promise<void>;

	/**
	 * Clears all managed instances
	 */
	clearAll(): Promise<void>;

	/**
	 * Clears the original managed instance and replaces with a new one
	 * @param id unique id of managed instance to override
	 * @param DisposableOrTimeout instances to manage instead
	 */
	override(
		id: number,
		...DisposableOrTimeout: (DisposableLike | Promise<DisposableLike> | NodeJS.Timeout | Promise<NodeJS.Timeout>)[]
	): Promise<void>;

	managed: (DisposableLike | NodeJS.Timeout)[][];
	autoIncrementInstanceID: number;
} = {
	async add(
		...DisposableOrTimeout: (DisposableLike | Promise<DisposableLike> | NodeJS.Timeout | Promise<NodeJS.Timeout>)[]
	): Promise<number> {
		this.managed.push(await Promise.all(DisposableOrTimeout));
		return this.autoIncrementInstanceID++;
	},

	async clear(id: number): Promise<void> {
		if (this.managed[id]?.length === 0) return;
		await Aux.async.map(this.managed[id], async (instance) => {
			(<{ dispose?: (...args: any) => any }>instance).dispose?.();
			try {
				clearTimeout(<NodeJS.Timeout>instance);
			} finally {
			}
		});
		this.managed[id] = [];
	},

	async clearAll(): Promise<void> {
		await Aux.async.range(this.autoIncrementInstanceID, async (i) => await this.clear(i));
	},

	async override(
		id: number,
		...DisposableOrTimeout: (DisposableLike | Promise<DisposableLike> | NodeJS.Timeout | Promise<NodeJS.Timeout>)[]
	): Promise<void> {
		if (this.managed[id].length === 0) throw new Error(`No managed instance to override with id ${id}`);
		await this.clear(id);
		this.managed[id] = await Promise.all(DisposableOrTimeout);
	},

	managed: [],
	autoIncrementInstanceID: 0,
};
