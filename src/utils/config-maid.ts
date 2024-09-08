import { ConfigurationChangeEvent, workspace } from "vscode";
import { Aux } from "./auxiliary";
import { Janitor } from "./janitor";

export type ListenList = {
	[configName: string]: null | ((retrieved: any) => any);
};

const configMaidInstances: ConfigMaid[] = [];

export async function disposeAllConfigMaids(): Promise<void> {
	await Aux.asyncFor(configMaidInstances, async (configMaid) => await configMaid.dispose());
}

export class ConfigMaid {
	private config = workspace.getConfiguration("better-memo");
	private configsMap = new Map();
	private janitor = new Janitor();

	constructor() {
		this.janitor.add(
			workspace.onDidChangeConfiguration((ev) => {
				if (!ev.affectsConfiguration("better-memo")) return;
				this.config = workspace.getConfiguration("better-memo");
			}),
		);
		configMaidInstances.push(this);
	}

	/**
	 * @param configNameOrList configuration's name
	 * or an object with config name as keys and ${callback?} as values
	 * @param callback an optional method to transform retrieved user config
	 */
	async listen(configNameOrList: string | ListenList, callback?: (retrieved: any) => any): Promise<void> {
		callback = callback ?? (async (r: any) => await r);
		if (typeof configNameOrList === "object") {
			await Aux.asyncFor(
				Object.entries(configNameOrList),
				async ([configName, callback]) => await this.listen(configName, callback),
			);
			return;
		}
		this.configsMap.set(configNameOrList, callback);
	}

	/**
	 * @param configName name of listened configuration to retrieve
	 */
	async get(configName: string): Promise<any> {
		if (!this.configsMap.has(configName)) throw new Error(`${configName} is not listened`);
		return await this.configsMap.get(configName)(this.config.get(configName));
	}

	/**
	 * @param configs configurations to listen for change
	 * @param callback function supplied with the new values in order of appearance in ${configs}
	 */
	async onChange(configs: string | string[], callback: (...newValues: any[]) => void): Promise<void> {
		const _configs = [configs].flat();
		const onChangeConfiguration = async (ev: ConfigurationChangeEvent) => {
			if (
				!ev.affectsConfiguration("better-memo") ||
				!_configs.some((config) => ev.affectsConfiguration(`better-memo.${config}`))
			)
				return;
			callback(
				...(await Aux.asyncFor(
					_configs,
					async (configName) => await this.configsMap.get(configName)(this.config.get(configName)),
				)),
			);
		};
		await this.janitor.add(workspace.onDidChangeConfiguration(async (ev) => onChangeConfiguration(ev)));
	}

	async dispose(): Promise<void> {
		await this.janitor.dispose();
	}
}
