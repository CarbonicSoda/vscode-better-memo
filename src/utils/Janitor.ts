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
		janitor.managed.push(await Promise.all(DisposableOrTimeout));
		return janitor.autoIncrementInstanceID++;
	},

	async clear(id: number): Promise<void> {
		if (janitor.managed[id]?.length === 0) return;
		await Aux.async.map(janitor.managed[id], async (instance) => {
			if (Object.hasOwn(instance, "dispose")) {
				(<{ dispose?: (...args: any) => any }>instance).dispose();
				return;
			}
			clearTimeout(<NodeJS.Timeout>instance);
		});
		janitor.managed[id] = [];
	},

	async clearAll(): Promise<void> {
		await Aux.async.range(janitor.autoIncrementInstanceID, async (i) => await janitor.clear(i));
	},

	async override(
		id: number,
		...DisposableOrTimeout: (DisposableLike | Promise<DisposableLike> | NodeJS.Timeout | Promise<NodeJS.Timeout>)[]
	): Promise<void> {
		if (janitor.managed[id].length === 0) throw new Error(`No managed instance to override with id ${id}`);
		await janitor.clear(id);
		janitor.managed[id] = await Promise.all(DisposableOrTimeout);
	},

	managed: [],
	autoIncrementInstanceID: 0,
};
