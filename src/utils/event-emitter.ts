import { Aux } from "./auxiliary";

export type EventEmitter = typeof eventEmitter;

export async function getEventEmitter(): Promise<EventEmitter> {
	return eventEmitter;
}

const eventEmitter: {
	/**
	 * @param event event name to subscribe to, names that start with __ or c__ are preserved
	 * @param callback callback function evoked on event dispatch
	 */
	subscribe(event: string, callback: (...args: any) => void | Promise<void>): Promise<Disposable>;

	/**
	 * @param event event name to dispatch
	 * @param args arguments to pass to callback functions
	 */
	emit(event: string, ...args: any): Promise<void>;

	/**
	 * Almost identical to dispatch(), but wait()s binded afterwards &
	 * before stopCriterion is met will also resolve
	 *
	 * If only event is provided, yields until default callback is returned
	 *
	 * @param stopCriterion determines when to stop listening to new wait()s...
	 * @param stopCriterion: number ~ timeout (in ms)
	 * @param stopCriterion: string ~ EventEmitter event name
	 * @param stopCriterion: callback ~ when invokes stop()
	 */
	emitWait(event: string, stopCriterion?: number, ...args: any): Promise<void>;

	emitWait(event: string, stopCriterion?: string, ...args: any): Promise<void>;

	emitWait(
		event: string,
		stopCriterion?: (stop: () => Promise<void>) => void | Promise<void>,
		...args: any
	): Promise<void>;

	/**
	 * @param event event name to wait for dispatch
	 * @param callback optional callback function evoked on dispatch
	 * @param callbackEvent optional event to emit after callback
	 * @param callbackArgs passes to callbackEvent emit
	 * @returns the returned value of callback
	 */
	wait<R>(event: string, callback?: (...args: any) => R, callbackEvent?: string, ...callbackArgs: any): Promise<R>;

	events: Map<string, ((...args: any) => void)[]>;
} = {
	async subscribe(event: string, callback: (...args: any) => void): Promise<Disposable> {
		if (!eventEmitter.events.has(event)) eventEmitter.events.set(event, []);
		eventEmitter.events.get(event).push(callback);
		return new Disposable(event, eventEmitter.events.get(event).length - 1);
	},

	async emit(event: string, ...args: any): Promise<void> {
		await Aux.async.map(
			eventEmitter.events.get(event) ?? [],
			async (callback?: (...args: any) => void | Promise<void>) => await callback?.(...args),
		);
	},

	async emitWait(
		event: string,
		stopCriterion?: number | string | ((stop: () => Promise<void>) => void),
		...args: any
	): Promise<void> {
		eventEmitter.emit(event, ...args);
		return await new Promise(async (resolve) => {
			const newListenerWatcher = await eventEmitter.subscribe(
				`__waitListenerAdded${event}`,
				async (onDispatch: (...args: any) => Promise<void>) => await onDispatch(...args),
			);
			const stop = async () => {
				newListenerWatcher.dispose();
				resolve();
			};
			switch (typeof stopCriterion) {
				case "number":
					setTimeout(stop, stopCriterion);
					break;
				case "string":
					const stopEvent = await eventEmitter.subscribe(stopCriterion, async () => {
						stop();
						stopEvent.dispose();
					});
					break;
				case "function":
					stopCriterion(stop);
					break;
				default:
					eventEmitter.wait(`c__${event}`, stop);
					break;
			}
		});
	},

	async wait<R>(
		event: string,
		callback: (...args: any) => R | Promise<R> = async () => undefined,
		callbackEvent?: string,
		...callbackArgs: any
	): Promise<R> {
		return await new Promise(async (resolve) => {
			const onDispatch = async (...args: any) => {
				resolve(await callback(...args));
				disposable.dispose();
				if (callbackEvent) eventEmitter.emit(callbackEvent, ...callbackArgs);
				eventEmitter.emit(`c__${event}`);
			};
			const disposable = await eventEmitter.subscribe(event, onDispatch);
			eventEmitter.emit(`__waitListenerAdded${event}`, onDispatch);
		});
	},

	events: new Map(),
};

class Disposable {
	constructor(private readonly event: string, private readonly id: number) {}

	async dispose(): Promise<void> {
		const removed = eventEmitter.events.get(this.event).filter((_, i) => i !== this.id);
		eventEmitter.events.set(this.event, removed);
	}
}
