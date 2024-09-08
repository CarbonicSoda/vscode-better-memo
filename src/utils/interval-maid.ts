import { Aux } from "./auxiliary";
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
		delayClamp?: { min: number; max: number },
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
		delayClamp?: { min: number; max: number },
		configCallback?: (retrieved: any) => any,
	): Promise<number> {
		await this.configMaid.listen(delayConfigName, configCallback);
		const intervalId = await this.janitor.add(setInterval(callback, await this.configMaid.get(delayConfigName)));
		await this.configMaid.onChange(delayConfigName, async (newDelay: number) => {
			if (delayClamp) newDelay = await Aux.clamp(newDelay, delayClamp.min, delayClamp.max);
			await this.janitor.override(intervalId, setInterval(callback, newDelay));
		});
		return intervalId;
	},

	async clear(intervalId: number): Promise<void> {
		await this.janitor.clear(intervalId);
	},

	async clearAll(): Promise<void> {
		await this.janitor.clearAll();
	},
};

let resolved = false;
const moduleUnresolvedError = new Error("interval-maid is not resolved");
export async function resolver(): Promise<void> {
	if (resolved) return;
	resolved = true;

	intervalMaid.configMaid = await getConfigMaid();
	intervalMaid.janitor = await getJanitor();
}
