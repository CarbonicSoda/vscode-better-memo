import { workspace } from "vscode";
import { Janitor } from "./janitor";

type ListenList = {
	[configName: string]: null | ((retrieved: any) => any);
};

const configMaidInstances: ConfigMaid[] = [];

export async function disposeConfigMaidInstances(): Promise<void> {
	for (const configMaid of configMaidInstances) {
		await configMaid.dispose();
	}
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
			for (const [configName, callback] of Object.entries(configNameOrList))
				await this.listen(configName, callback);
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
		await this.janitor.add(
			workspace.onDidChangeConfiguration(async (ev) => {
				if (
					!ev.affectsConfiguration("better-memo") ||
					!_configs.some((config) => ev.affectsConfiguration(`better-memo.${config}`))
				)
					return;
				callback(..._configs.map((config) => this.config.get(config)));
			}),
		);
	}

	async dispose(): Promise<void> {
		await this.janitor.dispose();
	}
}
