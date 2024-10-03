import { commands, Range, Selection, TextDocument, TextEditor, window } from "vscode";
import { Aux } from "./utils/auxiliary";
import { Janitor, getJanitor } from "./utils/janitor";
import { EventEmitter, getEventEmitter } from "./utils/event-emitter";
import { MemoEngine, getMemoEngine } from "./memo-engine";

let janitor: Janitor;
let eventEmitter: EventEmitter;
let memoEngine: MemoEngine;

async function initEditorCommands(): Promise<void> {
	if (!resolved) throw moduleUnresolvedError;

	await janitor.add(
		commands.registerTextEditorCommand(
			"better-memo.completeMemoOnLine",
			async (editor) => await editorCommands.completeMemoOnLine(editor),
		),
	);
}

namespace editorCommands {
	export async function completeMemoOnLine(editor: TextEditor) {
		const doc = editor.document;
		const active = editor.selection.active;
		const offset = doc.offsetAt(active) - 1;

		const memos = await getSortedMemos(editor, { onlyCurrentLine: true });
		let memoIndex = await Aux.algorithm.predecessorSearch(memos, offset, async (memo) => memo.offset);
		if (memoIndex === undefined) return;

		if (memoIndex === -1) memoIndex = 0;
		const targetMemo = memos[memoIndex];
		const start = doc.positionAt(targetMemo.offset);

		const deleteRange = new Range(start, start.translate(0, targetMemo.rawLength));
		await editor.edit(async (editBuilder) => {
			editBuilder.delete(deleteRange);
		});
		const selection = new Selection(start, start);
		editor.selection = selection;
		doc.save();
	}

	export async function navigateToLastMemo(editor: TextEditor) {
		// const doc = editor.document;
		// const active = editor.selection.active;
		// const offset = doc.offsetAt(active) - 1;
		// const { memos, offsets } = await getSortedMemos(editor);
	}

	async function getSortedMemos(editor: TextEditor, options?: { onlyCurrentLine?: boolean }) {
		const doc = editor.document;
		let memosInDoc = await memoEngine.getMemosInDoc(doc);

		if (options?.onlyCurrentLine) {
			const line = editor.selection.active.line;
			memosInDoc = memosInDoc.filter((memo) => memo.line === line);
		}

		memosInDoc.sort((a, b) => a.offset - b.offset);
		return memosInDoc;
	}
}

let resolved = false;
const moduleUnresolvedError = new Error("module editor-commands is not resolved");
export async function resolver(): Promise<void> {
	if (resolved) return;
	resolved = true;

	janitor = await getJanitor();
	eventEmitter = await getEventEmitter();
	memoEngine = await getMemoEngine();

	eventEmitter.wait("initEditorCommands", initEditorCommands);
}
