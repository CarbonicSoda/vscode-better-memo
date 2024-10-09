import { ConfigurationChangeEvent, workspace } from "vscode";
import { Janitor } from "./janitor";

export namespace ConfigMaid {
	let userConfigs = workspace.getConfiguration("better-memo");
	const configTransformMap: Map<string, (retrieved: any) => any> = new Map();

	export type ListenList = {
		[configName: string]: null | ((retrieved: any) => any);
	};

	/**
	 * @param configNameOrList configuration's name
	 * or an object with config name as keys and ${callback?} as values
	 * @param transform optional method to transform retrieved user config
	 */
	export function listen(configNameOrList: string | ListenList, transform: (retrieved: any) => any = (r) => r): void {
		if (typeof configNameOrList === "object") {
			for (const [configName, callback] of Object.entries(configNameOrList)) listen(configName, callback);
			return;
		}
		configTransformMap.set(configNameOrList, transform);
	}

	/**
	 * @param configName name of listened configuration to retrieve
	 */
	export function get(configName: string): any {
		if (!configTransformMap.has(configName)) throw new Error(`${configName} is not listened`);
		return configTransformMap.get(configName)(userConfigs.get(configName));
	}

	/**
	 * @param configs configurations to listen for change
	 * @param callback function supplied with the new values in order of appearance in ${configs}
	 */
	export function onChange(
		configs: string | string[],
		callback: (...newValues: any[]) => void | Promise<void>,
	): void {
		const _configs = [configs].flat();
		const onChangeConfig = async (ev: ConfigurationChangeEvent) => {
			if (
				!ev.affectsConfiguration("better-memo") ||
				!_configs.some((config) => ev.affectsConfiguration(`better-memo.${config}`))
			)
				return;
			userConfigs = workspace.getConfiguration("better-memo");
			await callback(..._configs.map(get));
		};
		Janitor.add(workspace.onDidChangeConfiguration(onChangeConfig));
	}

	/**
	 * Basically setInterval(),
	 * but the delay is a config and would automatically update.
	 * 
	 * **No need to add this to Janitor if not for manual clearing
	 * @returns intervalId for Janitor.clear() if of any use
	 */
	export function newInterval(
		callback: () => any,
		delayConfigName: string,
		transform?: (retrieved: any) => any,
	): number {
		listen(delayConfigName, transform);
		const intervalId = Janitor.add(setInterval(callback, get(delayConfigName)));
		onChange(delayConfigName, (newDelay: number) => Janitor.override(intervalId, setInterval(callback, newDelay)));
		return intervalId;
	}

	Janitor.add(
		workspace.onDidChangeConfiguration((ev) => {
			if (!ev.affectsConfiguration("better-memo")) return;
			userConfigs = workspace.getConfiguration("better-memo");
		}),
	);
}
