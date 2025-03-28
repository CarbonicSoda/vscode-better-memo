import { Janitor } from "./utils/janitor";

import { EditorCommands } from "./editor-commands";
import { EditorDecorations } from "./editor-decorations";
import { MemoEngine } from "./memo-engine";
import { ExplorerView } from "./tree-view";

/**
 * Extension entry point
 */
export async function activate(): Promise<void> {
	await MemoEngine.initEngine();
	ExplorerView.initExplorerView();
	EditorCommands.initEditorCommands();
	EditorDecorations.initEditorDecorations();
}

/**
 * Disposes explorer-view, all event listeners and cleans up all intervals etc
 */
export function deactivate(): void {
	Janitor.cleanUp();
}
