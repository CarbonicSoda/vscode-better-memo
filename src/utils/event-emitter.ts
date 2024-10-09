export namespace EventEmitter {
	const eventCallbacksMap: Map<string, ((...args: any) => void | Promise<void>)[]> = new Map();

	export class Disposable {
		constructor(private readonly event: string, private readonly id: number) {}

		dispose(): void {
			const removed = eventCallbacksMap.get(this.event).filter((_, i) => i !== this.id);
			eventCallbacksMap.set(this.event, removed);
		}
	}

	/**
	 * @param event event name to subscribe to, names that start with __ are reserved
	 * @param callback callback function evoked on event dispatch
	 */
	export function subscribe(event: string, callback: (...args: any) => any): Disposable {
		if (!eventCallbacksMap.has(event)) eventCallbacksMap.set(event, []);
		eventCallbacksMap.get(event).push(callback);
		return new Disposable(event, eventCallbacksMap.get(event).length - 1);
	}

	/**
	 * @param event event name to dispatch
	 * @param args arguments to pass to callback functions
	 */
	export function emit(event: string, ...args: any): void {
		for (const callback of eventCallbacksMap.get(event) ?? []) callback?.(...args);
	}

	/**
	 * Almost identical to emit(),
	 * but listeners binded before stop will also be invoked
	 * @param stop: after `_stop` is manually invoked in `stop`()
	 */
	export async function emitAndWait(event: string, stop: (_stop: () => void) => any, ...args: any): Promise<void>;

	/**
	 * Almost identical to emit(),
	 * but listeners binded before stop will also be invoked
	 * @param stop: after timeout(`stop`) (in ms)
	 */
	export async function emitAndWait(event: string, stop: number, ...args: any): Promise<void>;

	/**
	 * Almost identical to emit(),
	 * but listeners binded before stop will also be invoked
	 * @param stop: after `stop` is emitted
	 */
	export async function emitAndWait(event: string, stop: string, ...args: any): Promise<void>;

	/**
	 * Almost identical to emit(),
	 * but listeners binded before stop will also be invoked
	 * @param stop: after at least one `event` waiter callbacks
	 */
	export async function emitAndWait(event: string, stop: null, ...args: any): Promise<void>;

	export async function emitAndWait(
		event: string,
		stop: ((stop: () => void) => any) | number | string | null,
		...args: any
	): Promise<void> {
		switch (typeof stop) {
			case "number":
				return await emitAndWait(event, (_stop) => setTimeout(_stop, stop), ...args);
			case "string":
				return await emitAndWait(event, (_stop) => wait(stop, _stop), ...args);
		}
		if (stop === null) return await emitAndWait(event, (_stop) => wait(`__callback$${event}`, _stop), ...args);

		const promise = new Promise<void>((res) => {
			const newListenerWatcher = subscribe(`__listenerAdded$${event}`, (onDispatch: (...args: any) => void) =>
				onDispatch(...args),
			);
			stop(() => {
				newListenerWatcher.dispose();
				res();
			});
		});

		emit(event, ...args);
		return await promise;
	}

	/**
	 * @param event event name to wait for dispatch
	 * @param callback optional callback function evoked on dispatch
	 * @param callbackEvent optional event to emit after callback
	 * @param callbackArgs passes to callbackEvent emit
	 * @returns returned value of Awaited\<callback()\>
	 */
	export async function wait<R>(
		event: string,
		callback?: (...args: any) => R,
		callbackEvent?: string,
		...callbackArgs: any
	): Promise<R> {
		return new Promise((res) => {
			const onDispatch = async (...args: any) => {
				sub.dispose();
				res(await callback(...args));
				if (callbackEvent) emit(callbackEvent, ...callbackArgs);
				emit(`__callback$${event}`);
			};
			const sub = subscribe(event, onDispatch);
			emit(`__listenerAdded$${event}`, onDispatch);
		});
	}
}
