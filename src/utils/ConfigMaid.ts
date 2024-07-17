import { workspace } from "vscode";
const CONFIG = workspace.getConfiguration("better-memo");

const ConfigMaid: {
	/**
	 * @param configName name of configuration to keep track of
	 * @param callback an optional method to transform retrieved user config
	 */
	listen(configName: string, callback?: (retrieved: any) => any): void;
	/**
	 * @param configName name of listened configuration to retrieve
	 */
	get(configName: string): any;
	readonly _configsMap: Map<string, (retrieved: any) => any>;
	readonly _retrieved: Map<string, any>;
} = {
	_configsMap: new Map(),
	_retrieved: new Map(),
	listen(configName, callback = (r) => r) {
		this._configsMap.set(configName, callback);
	},
	get(configName) {
		return this._configsMap.get(configName)(CONFIG.get(configName));
	},
};
export default ConfigMaid;
