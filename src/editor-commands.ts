import { commands, Range, Selection, TextEditor, TextEditorEdit } from "vscode";
import { Aux } from "./utils/auxiliary";
import { Janitor } from "./utils/janitor";
import { MemoEngine } from "./memo-engine";

export namespace EditorCommands {
	export function initEditorCommands() {
		Janitor.add(
			commands.registerTextEditorCommand("better-memo.completeMemoOnLine", completeMemoOnLine),
			commands.registerTextEditorCommand("better-memo.navigateToLastMemo", navigateToMemoFactory("Last")),
			commands.registerTextEditorCommand("better-memo.navigateToNextMemo", navigateToMemoFactory("Next")),
		);
	}

	function completeMemoOnLine(editor: TextEditor, editBuilder: TextEditorEdit): void {
		const doc = editor.document;
		if (!MemoEngine.isDocWatched(doc)) return;
		const memos = MemoEngine.getMemosInDoc(editor.document);
		if (!memos || memos.length === 0) return;
		const lineMemos = <{ [line: number]: MemoEngine.MemoEntry[] }>Aux.object.group(memos, "line");

		const completed = [];
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
			const targetMemo = memosOnLine[i];
			if (Aux.object.includes(completed, targetMemo)) continue;

			const start = doc.positionAt(targetMemo.offset);
			editBuilder.delete(new Range(start, start.translate(0, targetMemo.length)));
			completed.push(targetMemo);
			newSelections.push(new Selection(start, start));
		}

		editor.selections = newSelections;
		doc.save();
	}

	function navigateToMemoFactory(target: "Last" | "Next") {
		return (editor: TextEditor) => {
			const doc = editor.document;
			if (!MemoEngine.isDocWatched(doc)) return;
			const memos = MemoEngine.getMemosInDoc(editor.document);
			if (!memos || memos.length === 0) return;

			const offset = doc.offsetAt(editor.selection.active) - 1;
			let i = Aux.algorithm.predecessorSearch(memos, offset, (memo) => memo.offset);
			let targetMemo;
			if (target === "Last") {
				if (i === 0) return;
				targetMemo = memos[i - 1];
			} else {
				if (i === memos.length - 1) return;
				targetMemo = memos[i + 1];
			}

			const pos = doc.positionAt(targetMemo.offset + targetMemo.length);
			editor.selection = new Selection(pos, pos);
			editor.revealRange(new Range(pos, pos));
		};
	}
}
