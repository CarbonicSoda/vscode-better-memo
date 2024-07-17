export const EventEmitter: {
	/**
	 * @param event event name to subscribe to
	 * @param callback callback function invoked on event evoke
	 */
	subscribe(event: string, callback: callbackType): Disposable;
	/**
	 * @param event event name to evoke
	 * @param args arguments to pass to callback functions
	 */
	evoke(event: string, ...args: any): void;
	readonly _events: Map<string, callbackType[]>;
} = {
	_events: new Map(),
	subscribe(event, callback) {
		if (!this._events.has(event)) this._events.set(event, []);
		this._events.get(event).push(callback);
		return new Disposable(event, this._events.get(event).length - 1);
	},
	evoke(event, ...args) {
		for (const callback of this._events.get(event) ?? []) callback?.(...args);
	},
};
/**
 * A type which can be disposed to stop event listening
 */
export class Disposable {
	constructor(private readonly _event: string, private readonly _id: number) {}
	dispose() {
		delete EventEmitter._events.get(this._event)[this._id];
	}
}
type callbackType = (...args: any) => void;
