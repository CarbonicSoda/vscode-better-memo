import {
	commands,
	Disposable,
	Position,
	Range,
	Selection,
	TextEditor,
	ThemeIcon,
	window,
} from "vscode";

import { Doc } from "../engine/doc";
import { Format } from "../engine/format";
import { Memo } from "../engine/memo";
import { Scan } from "../engine/scan";
import { Tag } from "../engine/tag";
import { Aux } from "../utils/auxiliary";
import { EventEmitter } from "../utils/event-emitter";
import { Janitor } from "../utils/janitor";

export namespace EditorCommands {
	export function init(): void {
		Janitor.add(
			commands.registerTextEditorCommand(
				"better-memo.newMemoOnLine",
				newMemoOnLine,
			),

			commands.registerTextEditorCommand(
				"better-memo.completeMemoNearCursor",
				completeMemoNearCursor,
			),

			commands.registerTextEditorCommand(
				"better-memo.navigateToPrevMemo",
				navigateToMemo("prev"),
			),
			commands.registerTextEditorCommand(
				"better-memo.navigateToNextMemo",
				navigateToMemo("next"),
			),
		);
	}

	async function newMemoOnLine(editor: TextEditor): Promise<void> {
		const doc = editor.document;
		if (!Doc.includes(doc)) return;

		const tags = Tag.data.tags.sort();
		const occurrence: { [tag: string]: number } = {};

		for (const tag of tags) {
			occurrence[tag] ??= 0;
			occurrence[tag]++;
		}

		const items = tags
			.sort((a, b) => occurrence[b] - occurrence[a])
			.map((tag) => ({
				label: tag,
				iconPath: new ThemeIcon("bookmark"),
			}));

		const picker = window.createQuickPick();
		picker.items = items;
		picker.canSelectMany = false;
		picker.placeholder = "Pick/Enter Tag";

		const runtime: {
			picked: string | undefined;
			disposables: Disposable[];
			disposePicker: () => void;
		} = {
			picked: undefined,
			disposables: [],
			disposePicker() {},
		};

		picker.onDidChangeValue(
			(tag) => {
				tag = tag.trim().toUpperCase();

				if (items.map((item) => item.label).includes(tag)) return;

				picker.items = Tag.isValid(tag)
					? items.concat({ label: tag, iconPath: new ThemeIcon("bookmark") })
					: items;
			},
			undefined,
			runtime.disposables,
		);

		picker.onDidAccept(
			() => {
				runtime.picked = picker.selectedItems[0].label;
				runtime.disposePicker();
			},
			undefined,
			runtime.disposables,
		);

		picker.onDidHide(runtime.disposePicker, undefined, runtime.disposables);

		picker.show();
		await new Promise<void>((res) => {
			runtime.disposePicker = () => {
				for (const disposable of runtime.disposables) disposable.dispose();
				picker.dispose();
				res();
			};
		});
		if (!runtime.picked) return;

		const { head, tail } = Format.getTemplate(doc.languageId);

		const selections = Array.from(editor.selections).sort((selA, selB) => {
			return selA.active.compareTo(selB.active);
		});

		const inserts: [Position, string][] = [];
		const cursors: Selection[] = [];

		for (const selection of selections) {
			const line = doc.lineAt(selection.active);

			const before = `${head}${runtime.picked} `;
			const after = `${tail}\n${line.text.slice(
				0,
				line.firstNonWhitespaceCharacterIndex,
			)}`;

			const insertPos = line.range.start.translate(
				0,
				line.firstNonWhitespaceCharacterIndex,
			);
			inserts.push([insertPos, before + after]);

			const cursor = insertPos.translate(cursors.length, before.length);
			cursors.push(new Selection(cursor, cursor));
		}

		await editor.edit((edit) => {
			for (const [pos, text] of inserts) edit.insert(pos, text);
		});
		editor.selections = cursors;

		await Scan.activeDoc();
		EventEmitter.emit("Update");
	}

	async function completeMemoNearCursor(editor: TextEditor): Promise<void> {
		const doc = editor.document;
		if (!Doc.includes(doc)) return;

		const memos = Memo.inDoc(editor.document);
		if (memos.length === 0) return;

		const lineMemos = Aux.object.group(memos, (memo) => memo.meta.line);

		const completed: Memo.Memo[] = [];
		const deleteRanges: Range[] = [];

		for (const selection of editor.selections) {
			const memos = lineMemos.get(selection.active.line);
			if (!memos) continue;

			let active = editor.selection.active;
			if (Format.getTemplate(doc.languageId).tail) {
				active = active.translate(0, -1);
			}

			let i = Aux.algorithm.predecessorSearch(
				active,
				memos,
				(memo) => memo.meta.start,
				(posA, posB) => posA.compareTo(posB),
			);
			if (i === -1) i = 0;

			const target = memos[i!];
			if (completed.includes(target)) continue;

			const line = target.meta.line;

			const removeLine =
				line < doc.lineCount - 1 &&
				doc.lineAt(line).firstNonWhitespaceCharacterIndex ===
					target.meta.start.character;

			const start = removeLine
				? doc.lineAt(line).range.start
				: target.meta.start;
			const end = removeLine ? new Position(line + 1, 0) : target.meta.end;

			completed.push(target);
			deleteRanges.push(new Range(start, end));
		}

		await editor.edit((edit) => {
			for (const range of deleteRanges) edit.delete(range);
		});

		await Scan.activeDoc();
		EventEmitter.emit("Update");
	}

	function navigateToMemo(
		target: "prev" | "next",
	): (editor: TextEditor) => void {
		return (editor: TextEditor) => {
			const doc = editor.document;
			if (!Doc.includes(doc)) return;

			const memos = Memo.inDoc(editor.document);
			if (memos.length === 0) return;

			memos.sort((memoA, memoB) => {
				return memoA.meta.start.compareTo(memoB.meta.start);
			});

			let active = editor.selection.active;
			if (Format.getTemplate(doc.languageId).tail) {
				active = active.translate(0, -1);
			}

			let i = Aux.algorithm.predecessorSearch(
				active,
				memos,
				(memo) => memo.meta.start,
				(posA, posB) => posA.compareTo(posB),
			);
			if (i === -1) i = 0;

			const targetMemo: Memo.Memo =
				target === "prev"
					? memos.at(i! - 1)!
					: memos.at((i! + 1) % memos.length)!;

			const pos = targetMemo.meta.end;

			editor.selections = [new Selection(pos, pos)];
			editor.revealRange(new Range(pos, pos));
		};
	}
}
