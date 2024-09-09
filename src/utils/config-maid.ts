import { ConfigurationChangeEvent, workspace, WorkspaceConfiguration } from "vscode";
import { Aux } from "./auxiliary";
import { Janitor, getJanitor } from "./janitor";

export type ListenList = {
	[configName: string]: null | ((retrieved: any) => any);
};

export type ConfigMaid = typeof configMaid;

export async function getConfigMaid(): Promise<ConfigMaid> {
	if (!resolved) throw moduleUnresolvedError;

	return configMaid;
}

const configMaid: {
	/**
	 * @param configNameOrList configuration's name
	 * or an object with config name as keys and ${callback?} as values
	 * @param callback an optional method to transform retrieved user config
	 */
	listen(configNameOrList: string | ListenList, callback?: (retrieved: any) => any): Promise<void>;

	/**
	 * @param configName name of listened configuration to retrieve
	 */
	get(configName: string): Promise<any>;

	/**
	 * @param configs configurations to listen for change
	 * @param callback function supplied with the new values in order of appearance in ${configs}
	 */
	onChange(configs: string | string[], callback: (...newValues: any[]) => void): Promise<void>;

	configs: WorkspaceConfiguration;
	configsMap: Map<string, (retrieved: any) => any>;

	janitor?: Janitor;
} = {
	async listen(configNameOrList: string | ListenList, callback?: (retrieved: any) => any): Promise<void> {
		callback = callback ?? (async (r: any) => await r);
		if (typeof configNameOrList === "object") {
			await Aux.async.map(
				Object.entries(configNameOrList),
				async ([configName, callback]) => await this.listen(configName, callback),
			);
			return;
		}
		this.configsMap.set(configNameOrList, callback);
	},

	async get(configName: string): Promise<any> {
		if (!this.configsMap.has(configName)) throw new Error(`${configName} is not listened`);
		return await this.configsMap.get(configName)(this.configs.get(configName));
	},

	async onChange(configs: string | string[], callback: (...newValues: any[]) => void): Promise<void> {
		const _configs = [configs].flat();
		const onChangeConfiguration = async (ev: ConfigurationChangeEvent) => {
			if (
				!ev.affectsConfiguration("better-memo") ||
				!_configs.some((config) => ev.affectsConfiguration(`better-memo.${config}`))
			)
				return;
			this.configs = workspace.getConfiguration("better-memo");
			callback(...(await Aux.async.map(_configs, async (configName) => await this.get(configName))));
		};
		await this.janitor.add(workspace.onDidChangeConfiguration(async (ev) => onChangeConfiguration(ev)));
	},

	configs: workspace.getConfiguration("better-memo"),
	configsMap: new Map(),
};

let resolved = false;
const moduleUnresolvedError = new Error("config-maid is not resolved");
export async function resolver(): Promise<void> {
	if (resolved) return;
	resolved = true;

	configMaid.janitor = await getJanitor();
	await configMaid.janitor.add(
		workspace.onDidChangeConfiguration(async (ev) => {
			if (!ev.affectsConfiguration("better-memo")) return;
			configMaid.configs = workspace.getConfiguration("better-memo");
		}),
	);
}
