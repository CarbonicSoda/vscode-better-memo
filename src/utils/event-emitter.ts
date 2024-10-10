export namespace EventEmitter {
	export class Disposable {
		constructor(private readonly event: string, private readonly id: number) {}

		dispose(): void {
			const removed = eventCallbacksMap.get(this.event).filter((_, i) => i !== this.id);
			eventCallbacksMap.set(this.event, removed);
		}
	}

	const eventCallbacksMap: Map<string, ((...args: any) => void | Promise<void>)[]> = new Map();

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
	 * Similar to emit() but will wait until at least one listener is invoked
	 */
	export async function emitAndWait(
		event: string,
		...args: any
	): Promise<void> {
		const promise = new Promise<void>((res) => {
			const newListenerWatcher = subscribe(`__listenerAdded$${event}`, (onDispatch: (...args: any) => Promise<void>) =>
				onDispatch(...args),
			);
			wait(`__callback$${event}`, () => {
				newListenerWatcher.dispose();
				res();
			})
		});
		emit(event, ...args);
		return await promise;
	}

	/**
	 * @param event event name to wait for dispatch
	 * @param callback optional callback function evoked on dispatch
	 * @returns returned value of Awaited\<callback()\>
	 */
	export async function wait<R>(
		event: string,
		callback?: (...args: any) => R
	): Promise<R> {
		return new Promise((res) => {
			const onDispatch = async (...args: any) => {
				sub.dispose();
				res(await callback(...args));
				emit(`__callback$${event}`);
			};
			const sub = subscribe(event, onDispatch);
			emit(`__listenerAdded$${event}`, onDispatch);
		});
	}
}
