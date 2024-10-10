import { Janitor } from "./utils/janitor";
import { MemoEngine } from "./memo-engine";
import { ExplorerView } from "./explorer-view";
import { EditorCommands } from "./editor-commands";

export async function activate(): Promise<void> {
	await MemoEngine.initEngine();
	ExplorerView.initExplorer();
	EditorCommands.initEditorCommands();
}

export function deactivate(): void {
	Janitor.cleanUp();
}
