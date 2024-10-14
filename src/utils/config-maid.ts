import { workspace } from "vscode";
import { Janitor } from "./janitor";

/**
 * Simplified functions for config related tasks
 */
export namespace ConfigMaid {
	let userConfigs = workspace.getConfiguration("better-memo");

	/**
	 * `configName` should omit "better-memo." field prefix
	 */
	export function get(configName: string): any {
		return userConfigs.get(configName);
	}

	/**
	 * @param callback supplied with the new config values in order of appearance in `configs`
	 * @returns `id` for {@link Janitor.clear()}
	 */
	export function onChange(configs: string | string[], callback: (...newValues: any[]) => any): number {
		const _configs = [configs].flat();
		const onChangeConfig = workspace.onDidChangeConfiguration((ev) => {
			if (
				!ev.affectsConfiguration("better-memo") ||
				!_configs.some((config) => ev.affectsConfiguration(`better-memo.${config}`))
			)
				return;
			userConfigs = workspace.getConfiguration("better-memo");
			callback(..._configs.map(get));
		});
		return Janitor.add(onChangeConfig);
	}

	/**
	 * Basically `setInterval()`,
	 * but the delay is a config value and will auto update
	 * @returns `id` for {@link Janitor.clear()}
	 */
	export function newInterval(callback: () => any, delayConfigName: string): number {
		const intervalId = Janitor.add(setInterval(callback, get(delayConfigName)));
		onChange(delayConfigName, (newDelay) => Janitor.override(intervalId, setInterval(callback, newDelay)));
		return intervalId;
	}

	Janitor.add(
		workspace.onDidChangeConfiguration((ev) => {
			if (!ev.affectsConfiguration("better-memo")) return;
			userConfigs = workspace.getConfiguration("better-memo");
		}),
	);
}
