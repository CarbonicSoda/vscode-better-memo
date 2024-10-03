import { commands, Range, Selection, TextEditor } from "vscode";
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

		let memosInDoc = await memoEngine.getMemosInDoc(doc);
		memosInDoc = memosInDoc.filter((memo) => memo.line === active.line);
		memosInDoc.sort((a, b) => a.offset - b.offset);
		const memoOffsets = await Aux.async.map(memosInDoc, async (memo) => memo.offset + memo.rawLength);
		const offset = doc.offsetAt(active) - 1;

		let lastMemoIndex = await Aux.algorithm.predecessorSearch(memoOffsets, offset);
		if (!lastMemoIndex) return;

		if (lastMemoIndex === memosInDoc.length - 1) lastMemoIndex--;
		const targetMemo = memosInDoc[lastMemoIndex + 1];
		const start = doc.positionAt(targetMemo.offset);
		const end = start.translate(0, targetMemo.rawLength);

		const deleteRange = new Range(start, end);
		await editor.edit(async (editBuilder) => {
			editBuilder.delete(deleteRange);
		});
		const selection = new Selection(start, start);
		editor.selection = selection;
		doc.save();
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
