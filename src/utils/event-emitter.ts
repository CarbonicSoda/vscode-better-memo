/**
 * One-way inner/cross-module emmiter mainly used for decoupling
 */
export namespace EventEmitter {
	/**
	 * Class that could be disposed to stop event listening
	 */
	export class Disposable {
		constructor(readonly event: string, readonly id: number) {}

		/**
		 * Unsubscribes from `this.event`
		 */
		dispose(): void {
			const removed = eventCallbacksMap
				.get(this.event)
				?.filter((_, i) => i !== this.id);
			if (!removed) return;

			eventCallbacksMap.set(this.event, removed);
		}
	}

	const eventCallbacksMap: Map<string, ((...args: any) => any)[]> = new Map();

	/**
	 * @param callback callback function evoked on `event`'s dispatch
	 */
	export function subscribe(
		event: string,
		callback: (...args: any) => any,
	): Disposable {
		if (!eventCallbacksMap.has(event)) eventCallbacksMap.set(event, []);
		eventCallbacksMap.get(event)!.push(callback);

		return new Disposable(event, eventCallbacksMap.get(event)!.length - 1);
	}

	/**
	 * @param args arguments to pass to subscribed callback functions
	 */
	export function emit(event: string, ...args: any): void {
		for (const callback of eventCallbacksMap.get(event) ?? []) {
			callback(...args);
		}
	}
}
