import Janitor from "./Janitor";
import ConfigMaid from "./ConfigMaid";

export default class IntervalMaid {
	add(callback: () => void, delayConfigName: string, configCallback?: (retrieved: any) => any) {
		ConfigMaid.listen(delayConfigName, configCallback);
		const intervalId = this._intervalJanitor.add(setInterval(callback, ConfigMaid.get(delayConfigName)));
		this._configChangeJanitor.add(
			ConfigMaid.onChange(delayConfigName, () =>
				this._intervalJanitor.override(
					intervalId,
					setInterval(callback, ConfigMaid.get(delayConfigName)),
				),
			),
		);
		return intervalId;
	}
	clear(intervalId: number) {
		this._intervalJanitor.clear(intervalId);
	}
	clearAll() {
		this._intervalJanitor.clearAll();
	}
	dispose() {
		this.clearAll();
		this._configChangeJanitor.clearAll();
	}

	private _intervalJanitor = new Janitor();
	private _configChangeJanitor = new Janitor();
}
type DisposableLike = {
	[any: string]: any;
	dispose(...args: any): void;
};
