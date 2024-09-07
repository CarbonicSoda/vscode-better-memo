import { ConfigMaid } from "./config-maid";
import { Janitor } from "./janitor";

export class IntervalMaid {
	private configMaid = new ConfigMaid();
	private intervalJanitor = new Janitor();

	async add(
		callback: () => void | Promise<void>,
		delayConfigName: string,
		configCallback?: (retrieved: any) => any,
	): Promise<number> {
		await this.configMaid.listen(delayConfigName, configCallback);
		const intervalId = await this.intervalJanitor.add(
			setInterval(callback, await this.configMaid.get(delayConfigName)),
		);
		await this.configMaid.onChange(delayConfigName, async (newDelay) =>
			this.intervalJanitor.override(intervalId, setInterval(callback, newDelay)),
		);
		return intervalId;
	}

	async clear(intervalId: number): Promise<void> {
		await this.intervalJanitor.clear(intervalId);
	}

	async clearAll(): Promise<void> {
		await this.intervalJanitor.clearAll();
	}

	async dispose(): Promise<void> {
		await this.configMaid.dispose();
		await this.intervalJanitor.dispose();
	}
}
