/**
 * Configs used in editor-commands.ts:
 * actions.newMemoOnNewLine
 * actions.removeLineIfMemoSpansLine
 */

import {
	commands,
	Disposable,
	EndOfLine,
	Position,
	Range,
	Selection,
	TextEditor,
	TextEditorEdit,
	ThemeIcon,
	window,
} from "vscode";

import { Aux } from "./utils/auxiliary";
import { ConfigMaid } from "./utils/config-maid";
import { EventEmitter } from "./utils/event-emitter";
import { Janitor } from "./utils/janitor";

import { MemoEngine } from "./memo-engine";

/**
 * Registry of `TextEditorCommand`s available in watched text documents
 */
export namespace EditorCommands {
	/**
	 * Registers all `TextEditorCommand`s
	 */
	export function initEditorCommands(): void {
		Janitor.add(
			commands.registerTextEditorCommand(
				"better-memo.newMemoOnLine",
				newMemoOnLine,
			),
			commands.registerTextEditorCommand(
				"better-memo.completeMemoNextToSelection",
				completeMemoNextToSelection,
			),
			commands.registerTextEditorCommand(
				"better-memo.navigateToLastMemo",
				navigateToMemoFactory("Last"),
			),
			commands.registerTextEditorCommand(
				"better-memo.navigateToNextMemo",
				navigateToMemoFactory("Next"),
			),
		);
	}

	/**
	 * Asks for a tag and inserts a new Memo on the current line
	 */
	async function newMemoOnLine(editor: TextEditor): Promise<void> {
		const doc = editor.document;
		if (!MemoEngine.isDocWatched(doc)) return;

		// const tagColors = await MemoEngine.getTagColors();
		// UNTIL VSCODE ADDS SUPPORT FOR CUSTOM ITEM COLORS
		const tags = MemoEngine.getTags({ sortOccurrence: true }).map((tag) => ({
			label: tag,
			iconPath: new ThemeIcon("bookmark"),
			// iconPath: new ThemeIcon("bookmark", tagColors[tag]),
			// UNTIL VSCODE ADDS SUPPORT FOR CUSTOM ITEM COLORS
		}));
		const pick = window.createQuickPick();
		pick.items = tags;

		let pickedTag: string | undefined;
		const disposables: Disposable[] = [];
		let disposeQuickPick = () => {};
		pick.onDidChangeValue(
			(tag) => {
				tag = tag.trim().toUpperCase();
				if (pick.items.map((item) => item.label).includes(tag)) return;
				pick.items = MemoEngine.isTagValid(tag)
					? tags.concat({ label: tag, iconPath: new ThemeIcon("bookmark") })
					: tags;
			},
			null,
			disposables,
		);
		pick.onDidAccept(
			() => {
				pickedTag = pick.selectedItems[0].label;
				disposeQuickPick();
			},
			null,
			disposables,
		);
		pick.onDidHide(disposeQuickPick, null, disposables);
		await new Promise<void>((res) => {
			disposeQuickPick = () => {
				pick.dispose();
				for (const disposable of disposables) disposable.dispose();
				res();
			};
			pick.show();
		});
		if (!pickedTag) return;

		const line = doc.lineAt(editor.selection.active);
		const { head, tail } = MemoEngine.getMemoTemplate(doc.languageId);
		const forceNewLine =
			!tail &&
			MemoEngine.getMemosInDoc(doc).some(
				(memo) => memo.line === line.lineNumber,
			);
		const insertOnNewLine =
			ConfigMaid.get("actions.newMemoOnNewLine") || forceNewLine;
		const insertPadding =
			!insertOnNewLine &&
			!tail &&
			!line.isEmptyOrWhitespace &&
			!line.text.endsWith(" ");

		const before = `${insertPadding ? " " : ""}${head}${pickedTag} `;
		let after = tail;
		if (insertOnNewLine) {
			after +=
				(doc.eol === EndOfLine.LF ? "\n" : "\r\n") +
				line.text.slice(0, line.firstNonWhitespaceCharacterIndex);
		}

		const insertPos = insertOnNewLine
			? line.range.start.translate(0, line.firstNonWhitespaceCharacterIndex)
			: line.range.end;
		await editor.edit((editBuilder) =>
			editBuilder.insert(insertPos, before + after),
		);
		const pos = insertPos.translate(0, before.length);
		editor.selections = [new Selection(pos, pos)];
		EventEmitter.emit("scan", doc);
	}

	/**
	 * Marks Memos next to editor selections as completed
	 */
	function completeMemoNextToSelection(
		editor: TextEditor,
		editBuilder: TextEditorEdit,
	): void {
		const doc = editor.document;
		if (!MemoEngine.isDocWatched(doc)) return;
		const memos = MemoEngine.getMemosInDoc(editor.document);
		if (!memos || memos.length === 0) return;
		const lineMemos = <{ [line: number]: MemoEngine.Memo[] }>(
			Aux.object.group(memos, "line")
		);

		const completed: MemoEngine.Memo[] = [];
		for (const selection of editor.selections) {
			const memosOnLine = lineMemos[selection.active.line];
			if (!memosOnLine || memosOnLine.length === 0) continue;

			const offset = doc.offsetAt(selection.active) - 1;
			let i = Aux.algorithm.predecessorSearch(
				memosOnLine,
				offset,
				(memo) => memo.offset,
			);
			if (i === -1) i = 0;
			const targetMemo = memosOnLine[i];
			if (completed.includes(targetMemo)) continue;

			const doRemoveLine =
				ConfigMaid.get("actions.removeLineIfMemoSpansLine") &&
				targetMemo.line < doc.lineCount - 1 &&
				doc.lineAt(targetMemo.line).firstNonWhitespaceCharacterIndex ===
					doc.positionAt(targetMemo.offset).character;
			const start = doRemoveLine
				? doc.lineAt(targetMemo.line).range.start
				: doc.positionAt(targetMemo.offset);
			const end = doRemoveLine
				? new Position(targetMemo.line + 1, 0)
				: start.translate(0, targetMemo.length);

			editBuilder.delete(new Range(start, end));
			completed.push(targetMemo);
		}

		doc.save();
	}

	/**
	 * Function factory: navigates to the last (next) Memo in the editor, from current selection
	 */
	function navigateToMemoFactory(
		target: "Last" | "Next",
	): (editor: TextEditor) => void {
		return (editor: TextEditor) => {
			const doc = editor.document;
			if (!MemoEngine.isDocWatched(doc)) return;
			const memos = MemoEngine.getMemosInDoc(editor.document);
			if (!memos || memos.length === 0) return;

			const offset = doc.offsetAt(editor.selection.active) - 1;
			let i = Aux.algorithm.predecessorSearch(
				memos,
				offset,
				(memo) => memo.offset,
			);
			let targetMemo;
			if (target === "Last") {
				if (i === 0) return;
				targetMemo = memos[i - 1];
			} else {
				if (i === memos.length - 1) return;
				targetMemo = memos[i + 1];
			}

			const pos = doc.positionAt(targetMemo.offset + targetMemo.length);
			editor.selections = [new Selection(pos, pos)];
			editor.revealRange(new Range(pos, pos));
		};
	}
}
