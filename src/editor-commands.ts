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

		const active = editor.selection.active;
		const offset = doc.offsetAt(active) - 1;

		const memos = getSortedMemos(editor, { onlyCurrLine: true });
		let memoIndex = Aux.algorithm.predecessorSearch(memos, offset, (memo) => memo.offset);
		if (memoIndex === undefined) return;
		if (memoIndex === -1) memoIndex = 0;
		const targetMemo = memos[memoIndex];

		const start = doc.positionAt(targetMemo.offset);
		editBuilder.delete(new Range(start, start.translate(0, targetMemo.rawLength)));
		editor.selection = new Selection(start, start);
		doc.save();
	}

	// export async function navigateToLastMemo(editor: TextEditor) {
	// 	// const doc = editor.document;
	// 	// const active = editor.selection.active;
	// 	// const offset = doc.offsetAt(active) - 1;
	// 	// const { memos, offsets } = await getSortedMemos(editor);
	// }

	function getSortedMemos(editor: TextEditor, options?: { onlyCurrLine?: boolean }): MemoEngine.MemoEntry[] {
		let memos = MemoEngine.getMemosInDoc(editor.document);
		if (options?.onlyCurrLine) {
			const currLine = editor.selection.active.line;
			memos = memos.filter((memo) => memo.line === currLine);
		}
		return memos.sort((a, b) => a.offset - b.offset);
	}
}
