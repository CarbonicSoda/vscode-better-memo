import { workspace, Disposable, WorkspaceConfiguration } from "vscode";

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
	onChange(configs: string | string[], callback: (newValues: NewValues) => void): Disposable;
	dispose(): void;

	_config: WorkspaceConfiguration;
	_configsMap: Map<string, (retrieved: any) => any>;
	_retrieved: Map<string, any>;
	_onChangeConfig: Disposable;
} = {
	listen(configNameOrList, callback = (r: any) => r) {
		if (typeof configNameOrList === "object") {
			for (const [configName, callback] of Object.entries(configNameOrList))
				this.listen(configName, callback ?? ((r) => r));
			return;
		}
		//@ts-ignore
		this._configsMap.set(configNameOrList, callback);
	},
	get(configName) {
		return this._configsMap.get(configName)(this._config.get(configName));
	},
	onChange(configs, callback) {
		const _configs = [configs].flat();
		return workspace.onDidChangeConfiguration((ev) => {
			if (!ev.affectsConfiguration("better-memo")) return;
			if (!_configs.some((config) => ev.affectsConfiguration(`better-memo.${config}`))) return;
			callback(Object.fromEntries(_configs.map((config) => [config, this._config.get(config)])));
		});
	},
	dispose() {
		this._onChangeConfig.dispose();
	},

	_config: workspace.getConfiguration("better-memo"),
	_configsMap: new Map(),
	_retrieved: new Map(),
	_onChangeConfig: workspace.onDidChangeConfiguration((ev) => {
		if (!ev.affectsConfiguration("better-memo")) return;
		ConfigMaid._config = workspace.getConfiguration("better-memo");
	}),
};
type ListenList = {
	[configName: string]: null | ((retrieved: any) => any);
};
type NewValues = {
	[changedConfig: string]: any;
};
export default ConfigMaid;
