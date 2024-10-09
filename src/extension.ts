import { Janitor } from "./utils/janitor";
import { ExplorerView } from "./explorer-view";

export function activate(): void {
	ExplorerView.initExplorer();
}

export function deactivate(): void {
	Janitor.cleanUp();
}
