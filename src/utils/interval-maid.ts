import { Janitor } from "./janitor";
import { getConfigMaid } from "./config-maid";

const ConfigMaid = getConfigMaid();
export class IntervalMaid {
	add(callback: () => void, delayConfigName: string, configCallback?: (retrieved: any) => any) {
		ConfigMaid.listen(delayConfigName, configCallback);
		const intervalId = this.intervalJanitor.add(setInterval(callback, ConfigMaid.get(delayConfigName)));
		this.configChangeJanitor.add(
			ConfigMaid.onChange(delayConfigName, (delay) =>
				this.intervalJanitor.override(intervalId, setInterval(callback, delay)),
			),
		);
		return intervalId;
	}
	clear(intervalId: number) {
		this.intervalJanitor.clear(intervalId);
	}
	clearAll() {
		this.intervalJanitor.clearAll();
	}
	dispose() {
		this.clearAll();
		this.configChangeJanitor.clearAll();
	}

	private intervalJanitor = new Janitor();
	private configChangeJanitor = new Janitor();
}
