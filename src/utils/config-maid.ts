import { workspace, Disposable, WorkspaceConfiguration } from "vscode";

type ListenList = {
	[configName: string]: null | ((retrieved: any) => any);
};

export function getConfigMaid(): typeof ConfigMaid {
	return ConfigMaid;
}

const ConfigMaid: {
	/**
	 * @param configName name of configuration to keep track of
	 * @param callback an optional method to transform retrieved user config
	 */
	listen(configName: string, callback?: (retrieved: any) => any): void;

	/**
	 * @param configList {[configName]: callback}
	 */
	listen(configList: ListenList): void;

	/**
	 * @param configName name of listened configuration to retrieve
	 */
	get(configName: string): any;

	/**
	 * @param configs configurations to listen for change
	 * @param callback function supplied with the new values packed into an object
	 */
	onChange(configs: string | string[], callback: (...newValues: any[]) => void): Disposable;

	dispose(): void;

	config: WorkspaceConfiguration;
	configsMap: Map<string, (retrieved: any) => any>;
	retrieved: Map<string, any>;
	onChangeConfig: Disposable;
} = {
	listen(configNameOrList: string | ListenList, callback: (retrieved: any) => any = (r: any) => r): void {
		if (typeof configNameOrList === "object") {
			for (const [configName, callback] of Object.entries(configNameOrList))
				this.listen(configName, callback ?? ((r) => r));
			return;
		}
		//@ts-ignore
		this.configsMap.set(configNameOrList, callback);
	},

	get(configName: string): any {
		if (!this.configsMap.has(configName)) throw new Error(`${configName} is not listened`);
		return this.configsMap.get(configName)(this.config.get(configName));
	},

	onChange(configs: string | string[], callback: (...newValues: any[]) => void): Disposable {
		const _configs = [configs].flat();
		return workspace.onDidChangeConfiguration((ev) => {
			if (!ev.affectsConfiguration("better-memo")) return;
			if (!_configs.some((config) => ev.affectsConfiguration(`better-memo.${config}`))) return;
			callback(..._configs.map((config) => this.config.get(config)));
		});
	},

	dispose(): void {
		this.onChangeConfig.dispose();
	},

	config: workspace.getConfiguration("better-memo"),
	configsMap: new Map(),
	retrieved: new Map(),
	onChangeConfig: workspace.onDidChangeConfiguration((ev) => {
		if (!ev.affectsConfiguration("better-memo")) return;
		ConfigMaid.config = workspace.getConfiguration("better-memo");
	}),
};
