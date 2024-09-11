import { Janitor, getJanitor } from "./janitor";
import { ConfigMaid, getConfigMaid } from "./config-maid";

export type IntervalMaid = typeof intervalMaid;

export async function getIntervalMaid(): Promise<IntervalMaid> {
	if (!resolved) throw moduleUnresolvedError;

	return intervalMaid;
}

const intervalMaid: {
	add(
		callback: () => void | Promise<void>,
		delayConfigName: string,
		configCallback?: (retrieved: any) => any,
	): Promise<number>;

	clear(intervalId: number): Promise<void>;
	clearAll(): Promise<void>;

	configMaid?: ConfigMaid;
	janitor?: Janitor;
} = {
	async add(
		callback: () => void | Promise<void>,
		delayConfigName: string,
		configCallback?: (retrieved: any) => any,
	): Promise<number> {
		await intervalMaid.configMaid.listen(delayConfigName, configCallback);
		const intervalId = await intervalMaid.janitor.add(
			setInterval(callback, await intervalMaid.configMaid.get(delayConfigName)),
		);
		await intervalMaid.configMaid.onChange(
			delayConfigName,
			async (newDelay: number) =>
				await intervalMaid.janitor.override(intervalId, setInterval(callback, newDelay)),
		);
		return intervalId;
	},

	async clear(intervalId: number): Promise<void> {
		await intervalMaid.janitor.clear(intervalId);
	},

	async clearAll(): Promise<void> {
		await intervalMaid.janitor.clearAll();
	},
};

let resolved = false;
const moduleUnresolvedError = new Error("interval-maid is not resolved");
export async function resolver(): Promise<void> {
	if (resolved) return;
	resolved = true;

	intervalMaid.janitor = await getJanitor();
	intervalMaid.configMaid = await getConfigMaid();
}
