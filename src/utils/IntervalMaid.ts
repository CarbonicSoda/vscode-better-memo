import Janitor from "./Janitor";
import ConfigMaid from "./ConfigMaid";

export default class IntervalMaid {
	public add(callback: () => void, delayConfigName: string, configCallback?: (retrieved: any) => any) {
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
	public clear(intervalId: number) {
		this._intervalJanitor.clear(intervalId);
	}
	public clearAll() {
		this._intervalJanitor.clearAll();
	}
	public dispose() {
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
