import { initEditor } from "./editor";
import { initEngine } from "./engine";
import { initTree } from "./tree";
import { Janitor } from "./utils/janitor";

/**
 * Extension entry point
 */
export async function activate(): Promise<void> {
	await initEngine();
	initTree();
	initEditor();
}

/**
 * Dispose explorer-view, all event listeners and cleans up all intervals etc
 */
export function deactivate(): void {
	Janitor.cleanUp();
}
