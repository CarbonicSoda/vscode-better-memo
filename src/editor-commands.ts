import { commands, Range, Selection, TextEditor, TextEditorEdit } from "vscode";
import { Aux } from "./utils/auxiliary";
import { Janitor } from "./utils/janitor";
import { MemoEngine } from "./memo-engine";

export namespace EditorCommands {
	export function initEditorCommands() {
		Janitor.add(commands.registerTextEditorCommand("better-memo.completeMemoOnLine", completeMemoOnLine));
	}

	function completeMemoOnLine(editor: TextEditor, editBuilder: TextEditorEdit): void {
		const doc = editor.document;
		if (!MemoEngine.isDocWatched(doc)) return;
		const memos = MemoEngine.getMemosInDoc(editor.document);
		if (!memos || memos.length === 0) return;
		const lineMemos = Aux.object.group(memos, "line");

		const completed: MemoEngine.MemoEntry[] = [];
		const newSelections = [];
		for (const selection of editor.selections) {
			const memosOnLine = lineMemos[selection.active.line];
			if (!memosOnLine || memosOnLine.length === 0) {
				newSelections.push(selection);
				continue;
			}

			const offset = doc.offsetAt(selection.active) - 1;
			let i = Aux.algorithm.predecessorSearch(memosOnLine, offset, (memo) => memo.offset);
			if (i === -1) i = 0;
			const targetMemo = <MemoEngine.MemoEntry>memosOnLine[i];
			if (Aux.object.includes(completed, targetMemo)) continue;

			const start = doc.positionAt(targetMemo.offset);
			editBuilder.delete(new Range(start, start.translate(0, targetMemo.rawLength)));
			completed.push(targetMemo);
			newSelections.push(new Selection(start, start));
		}

		editor.selections = newSelections;
		doc.save();
	}

	// export async function navigateToLastMemo(editor: TextEditor) {
	// 	const doc = editor.document;
	// 	const active = editor.selection.active;
	// 	const offset = doc.offsetAt(active) - 1;
	// 	const { memos, offsets } = await getSortedMemos(editor);
	// }
}
