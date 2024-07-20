export const EventEmitter: {
	/**
	 * @param event event name to subscribe to, names that start with __ or c__ shall be avoided
	 * @param callback callback function evoked on event dispatch
	 */
	subscribe(event: string, callback: (...args: any) => void): Disposable;
	/**
	 * @param event event name to dispatch
	 * @param args arguments to pass to callback functions
	 */
	emit(event: string, ...args: any): void;
	/**
	 * Almost identical as dispatch(), but wait()s binded afterwards
	 * before stopCriterion is met will also resolve
	 * @param stopCriterion determines when to stop listening to new wait()s:
	 * @param stopCriterion: number ~ timeout in ms
	 * @param stopCriterion: string ~ EventEmitter event name
	 * @param stopCriterion: callback ~ when invoked stop(), stops listening manually.
	 * Use c__event for implicit callback
	 * @returns a promise that resolves to the number of extra wait()s resolved before stop
	 */
	emitWait(event: string, stopCriterion: number, ...args: any): Promise<number>;
	emitWait(event: string, stopCriterion: string, ...args: any): Promise<number>;
	emitWait(event: string, stopCriterion: (stop: () => void) => void, ...args: any): Promise<number>;
	/**
	 * @param event event name to wait for dispatch
	 * @param callback optional callback function evoked on dispatch
	 * @param callbackEvent optional event to emit after callback
	 * @param callbackArgs passes to callbackEvent emit
	 * @returns a promise that resolves to the returned value of callback
	 */
	wait<R>(
		event: string,
		callback?: (...args: any) => R,
		callbackEvent?: string,
		...callbackArgs: any
	): Promise<R>;

	_events: Map<string, ((...args: any) => void)[]>;
} = {
	subscribe(event, callback) {
		if (!this._events.has(event)) this._events.set(event, []);
		this._events.get(event).push(callback);
		return new Disposable(event, this._events.get(event).length - 1);
	},
	emit(event, ...args) {
		for (const callback of this._events.get(event) ?? []) callback?.(...args);
	},
	async emitWait(event, stopCriterion, ...args) {
		this.emit(event, ...args);
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
			switch (typeof stopCriterion) {
				case "number":
					setTimeout(stop, stopCriterion);
					break;
				case "string":
					const disposable = this.subscribe(stopCriterion, () => {
						stop();
						disposable.dispose();
					});
					break;
				case "function":
					stopCriterion(stop);
					break;
			}
		});
	},
	async wait(event, callback, callbackEvent, ...callbackArgs) {
		callback = callback ?? (() => undefined);
		return new Promise((resolve) => {
			const disposable = this.subscribe(event, (...args) => {
				resolve(callback(...args));
				disposable.dispose();
				if (callbackEvent) this.emit(callbackEvent, ...callbackArgs);
				this.emit(`c__${event}`);
			});
			this.emit(`__waitListenerAdded${event}`, callback, resolve, disposable);
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
