export namespace EventEmitter {
	export function getEventEmitter(): typeof EventEmitter {
		return EventEmitter;
	}

	const EventEmitter: {
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
		 * before stopCriterion is met will also resolve.
		 * If only event is provided, yields until default callback is returned
		 * @param stopCriterion determines when to stop listening to new wait()s:
		 * @param stopCriterion: number ~ timeout in ms
		 * @param stopCriterion: string ~ EventEmitter event name
		 * @param stopCriterion: callback ~ when invoked stop(), stops listening manually.
		 * @returns a promise that resolves to the number of extra wait()s resolved before stop
		 */
		emitWait(event: string, stopCriterion?: number, ...args: any): Promise<number>;

		emitWait(event: string, stopCriterion?: string, ...args: any): Promise<number>;

		emitWait(event: string, stopCriterion?: (stop: () => void) => void, ...args: any): Promise<number>;

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

		events: Map<string, ((...args: any) => void)[]>;
	} = {
		subscribe(event: string, callback: (...args: any) => void): Disposable {
			if (!this.events.has(event)) this.events.set(event, []);
			this.events.get(event).push(callback);
			return new Disposable(event, this.events.get(event).length - 1);
		},

		emit(event: string, ...args: any): void {
			for (const callback of this.events.get(event) ?? []) callback?.(...args);
		},

		async emitWait(
			event: string,
			stopCriterion?: number | string | ((stop: () => void) => void),
			...args: any
		): Promise<number> {
			this.emit(event, ...args);
			let catched = 0;
			return new Promise((_resolve) => {
				const _disposable = this.subscribe(
					`__waitListenerAdded${event}`,
					(callback: (...args: any) => any, resolve: (value: any) => void, disposable: Disposable) => {
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
						const stopEvent = this.subscribe(stopCriterion, () => {
							stop();
							stopEvent.dispose();
						});
						break;
					case "function":
						stopCriterion(stop);
						break;
					default:
						const defaultStop = this.subscribe(`c__${event}`, () => {
							stop();
							defaultStop.dispose();
						});
						break;
				}
			});
		},

		async wait<R>(
			event: string,
			callback: (...args: any) => R,
			callbackEvent?: string,
			...callbackArgs: any
		): Promise<R> {
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

		events: new Map(),
	};

	/**
	 * A type which can be disposed to stop event listening
	 */
	export class Disposable {
		constructor(private readonly event: string, private readonly id: number) {}
		dispose(): void {
			delete EventEmitter.events.get(this.event)[this.id];
		}
	}
}
