export const EventEmitter: {
	/**
	 * @param event event name to subscribe to, names that start with __ shall be avoided
	 * @param callback callback function evoked on event dispatch
	 */
	subscribe(event: string, callback: (...args: any) => void): Disposable;
	/**
	 * @param event event name to dispatch
	 * @param args arguments to pass to callback functions
	 */
	dispatch(event: string, ...args: any): void;
	// /**
	//  * Almost identical as dispatch(), but wait()s binded afterwards within time ms will be resolved
	//  * @param time extra time to wait for wait() to be ran, in ms
	//  * @returns a promise that resolves to the number of extra wait()s resolved within time
	//  */
	dispatchWait(event: string, stopEvent: (stop: () => void) => void, ...args: any): Promise<number>;
	/**
	 * @param event event name to wait for dispatch
	 * @param callback optional callback function evoked on dispatch
	 * @param rejectAfter if provided, rejects the promise after given time in ms
	 * @returns a promise that resolves to the returned value of callback
	 */
	wait<R>(event: string, callback?: (...args: any) => R, rejectAfter?: number): Promise<R>;

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
	async dispatchWait(event, stopEvent, ...args) {
		this.dispatch(event, ...args);
		let catched = 0;
		return new Promise((_resolve) => {
			const _disposable = this.subscribe(
				`__waitListenerAdded${event}`,
				(
					callback: (...args: any) => any,
					resolve: (value: any) => void,
					disposable: Disposable,
				) => {
					resolve(callback(...args));
					disposable.dispose();
					catched++;
				},
			);
			const stop = () => {
				_disposable.dispose();
				_resolve(catched);
			};
			stopEvent(stop);
		});
	},
	async wait(event, callback = () => undefined, rejectAfter) {
		return new Promise((resolve, reject) => {
			const disposable = this.subscribe(event, (...args) => {
				resolve(callback(...args));
				disposable.dispose();
			});
			if (rejectAfter) {
				setTimeout(() => {
					reject(`Event "${event}" missed or not dispatched after ${rejectAfter}ms`);
					disposable.dispose();
				}, rejectAfter);
			}
			this.dispatch(`__waitListenerAdded${event}`, callback, resolve, disposable);
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
