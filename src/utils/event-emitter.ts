export namespace EventEmitter {
	export class Disposable {
		constructor(readonly event: string, readonly id: number) {}

		dispose(): void {
			const removed = eventCallbacksMap.get(this.event).filter((_, i) => i !== this.id);
			eventCallbacksMap.set(this.event, removed);
		}
	}

	const eventCallbacksMap: Map<string, ((...args: any) => any)[]> = new Map();

	/**
	 * @param event event to subscribe to
	 * @param callback callback function evoked on event dispatch
	 */
	export function subscribe(event: string, callback: (...args: any) => any): Disposable {
		if (!eventCallbacksMap.has(event)) eventCallbacksMap.set(event, []);
		eventCallbacksMap.get(event).push(callback);
		return new Disposable(event, eventCallbacksMap.get(event).length - 1);
	}

	/**
	 * @param event event to dispatch
	 * @param args arguments to pass to callback functions
	 */
	export function emit(event: string, ...args: any): void {
		for (const callback of eventCallbacksMap.get(event) ?? []) callback(...args);
	}
}
