/**
 * Configs used in editor-commands.ts:
 * actions.newMemoOnNewLine
 * actions.removeLineIfMemoSpansLine
 */

import { commands, EndOfLine, Position, Range, Selection, SnippetString, TextEditor, TextEditorEdit } from "vscode";
import { Aux } from "./utils/auxiliary";
import { ConfigMaid } from "./utils/config-maid";
import { Janitor } from "./utils/janitor";
import { MemoEngine } from "./memo-engine";

export namespace EditorCommands {
	export function initEditorCommands(): void {
		Janitor.add(
			commands.registerTextEditorCommand("better-memo.newMemoOnLine", newMemoOnLine),
			commands.registerTextEditorCommand("better-memo.completeMemoNextToSelection", completeMemoNextToSelection),
			commands.registerTextEditorCommand("better-memo.navigateToLastMemo", navigateToMemoFactory("Last")),
			commands.registerTextEditorCommand("better-memo.navigateToNextMemo", navigateToMemoFactory("Next")),
		);
	}

	function newMemoOnLine(editor: TextEditor): void {
		const doc = editor.document;
		const { open, close } = MemoEngine.getCommentDelimiters(doc);
		const line = doc.lineAt(editor.selection.active);
		const forceNewLine = !close && MemoEngine.getMemosInDoc(doc).some((memo) => memo.line === line.lineNumber);
		const insertOnNewLine = ConfigMaid.get("actions.newMemoOnNewLine") || forceNewLine;

		const insertPadding = !insertOnNewLine && !close && !line.isEmptyOrWhitespace;
		const opener = `${insertPadding ? " " : ""}${open}${close ? " " : ""}MO `;
		const memo = new SnippetString(opener);
		const tags = MemoEngine.getTags();
		if (tags.length !== 0) memo.appendChoice(tags);
		if (close) memo.appendText(` ${close}`);
		if (insertOnNewLine) memo.appendText(doc.eol === EndOfLine.LF ? "\n" : "\r\n");

		const pos = insertOnNewLine
			? line.range.start.translate(0, line.firstNonWhitespaceCharacterIndex)
			: line.range.end;
		editor.insertSnippet(memo, pos);
	}

	function completeMemoNextToSelection(editor: TextEditor, editBuilder: TextEditorEdit): void {
		const doc = editor.document;
		if (!MemoEngine.isDocWatched(doc)) return;
		const memos = MemoEngine.getMemosInDoc(editor.document);
		if (!memos || memos.length === 0) return;
		const lineMemos = <{ [line: number]: MemoEngine.Memo[] }>Aux.object.group(memos, "line");

		const completed: MemoEngine.Memo[] = [];
		for (const selection of editor.selections) {
			const memosOnLine = lineMemos[selection.active.line];
			if (!memosOnLine || memosOnLine.length === 0) continue;

			const offset = doc.offsetAt(selection.active) - 1;
			let i = Aux.algorithm.predecessorSearch(memosOnLine, offset, (memo) => memo.offset);
			if (i === -1) i = 0;
			const targetMemo = memosOnLine[i];
			if (completed.includes(targetMemo)) continue;

			const doRemoveLine =
				ConfigMaid.get("actions.removeLineIfMemoSpansLine") &&
				targetMemo.line < doc.lineCount - 1 &&
				doc.lineAt(targetMemo.line).firstNonWhitespaceCharacterIndex ===
					doc.positionAt(targetMemo.offset).character;
			const start = doRemoveLine ? doc.lineAt(targetMemo.line).range.start : doc.positionAt(targetMemo.offset);
			const end = doRemoveLine ? new Position(targetMemo.line + 1, 0) : start.translate(0, targetMemo.length);

			editBuilder.delete(new Range(start, end));
			completed.push(targetMemo);
		}

		doc.save();
	}

	function navigateToMemoFactory(target: "Last" | "Next"): (editor: TextEditor) => void {
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
