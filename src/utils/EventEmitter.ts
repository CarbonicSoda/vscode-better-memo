export const EventEmitter: {
	/**
	 * @param event event name to subscribe to
	 * @param callback callback function evoked on event dispatch
	 */
	subscribe(event: string, callback: (...args: any) => void): Disposable;
	/**
	 * @param event event name to dispatch
	 * @param args arguments to pass to callback functions
	 */
	dispatch(event: string, ...args: any): void;
	/**
	 * @param event event name to wait for dispatch
	 * @param callback optional callback function evoked on dispatch
	 * @returns a promise that resolves to the returned value of callback
	 */
	wait(event: string, callback?: (...args: any) => any): Promise<any>;

	_events: Map<string, ((...args: any) => void)[]>;
} = {
	subscribe(event, callback) {
		if (!this._events.has(event)) this._events.set(event, []);
		this._events.get(event).push(callback);
		return new Disposable(event, this._events.get(event).length - 1);
	},
	dispatch(event, ...args) {
		for (const callback of this._events.get(event) ?? []) callback?.(...args);
	},
	async wait(event, callback = () => {}) {
		return new Promise((resolve) => {
			const disposable = this.subscribe(event, (...args) => {
				resolve(callback(...args));
				disposable.dispose();
			});
		});
	},

	_events: new Map(),
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
