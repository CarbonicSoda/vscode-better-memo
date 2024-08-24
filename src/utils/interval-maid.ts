import { getConfigMaid } from "./config-maid";
import { Janitor } from "./janitor";

const configMaid = getConfigMaid();

export class IntervalMaid {
	private intervalJanitor = new Janitor();
	private configChangeJanitor = new Janitor();

	add(callback: () => void, delayConfigName: string, configCallback?: (retrieved: any) => any): number {
		configMaid.listen(delayConfigName, configCallback);
		const intervalId = this.intervalJanitor.add(setInterval(callback, configMaid.get(delayConfigName)));
		this.configChangeJanitor.add(
			configMaid.onChange(delayConfigName, (delay) =>
				this.intervalJanitor.override(intervalId, setInterval(callback, delay)),
			),
		);
		return intervalId;
	}

	clear(intervalId: number): void {
		this.intervalJanitor.clear(intervalId);
	}

	clearAll(): void {
		this.intervalJanitor.clearAll();
	}

	dispose(): void {
		this.clearAll();
		this.configChangeJanitor.clearAll();
	}
}
