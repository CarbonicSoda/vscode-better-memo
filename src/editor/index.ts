import { EditorCommands } from "./editor-commands";
import { EditorDecorations } from "./editor-decorations";

export function initEditor(): void {
	EditorCommands.init();
	EditorDecorations.init();
}
