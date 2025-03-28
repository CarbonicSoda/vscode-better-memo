/**
 * Configs used in editor-decorations.ts:
 * other.enableEditorDecorations
 */

import { Range, TextEditor, TextEditorDecorationType, window } from "vscode";

import { Aux } from "./utils/auxiliary";
import { ConfigMaid } from "./utils/config-maid";
import { EventEmitter } from "./utils/event-emitter";
import { Janitor } from "./utils/janitor";

import { MemoEngine } from "./memo-engine";

/**
 * Provides editor decorations
 */
export namespace EditorDecorations {
	/**
	 * Maps tags to their corresponding color-decoration-types
	 */
	type TagColorDecors = { [tag: string]: TextEditorDecorationType };

	const fontWeightDecor = window.createTextEditorDecorationType({
		fontWeight: "900",
	});

	const decoratedEditors: Set<TextEditor> = new Set();
	let prevDecorTypes: TextEditorDecorationType[] = [];
	let decorsEnabled = ConfigMaid.get("other.enableEditorDecorations");

	/**
	 * Inits all editor decorations and event listening
	 */
	export function initEditorDecorations(): void {
		ConfigMaid.onChange("other.enableEditorDecorations", (enable) => (decorsEnabled = enable));

		Janitor.add(
			window.onDidChangeVisibleTextEditors(decorEditors),
			EventEmitter.subscribe("update", async () => {
				if (!decorsEnabled) return;
				const active = window.activeTextEditor;
				if (!active) return;

				removePrevDecors(active);
				applyDecors(active, await getTagDecors());
			}),
		);

		decorEditors(window.visibleTextEditors);
	}

	/**
	 * Decorates `editors`
	 */
	async function decorEditors(editors: readonly TextEditor[]): Promise<void> {
		if (!decorsEnabled) return;
		if (editors.length === 0) return;

		const tagColorDecors = await getTagDecors();
		for (const editor of editors) applyDecors(editor, tagColorDecors);
	}

	/**
	 * Applies `tagColorDecors` and {@link fontWeightDecor} to `editor`
	 */
	function applyDecors(editor: TextEditor, tagColorDecors: TagColorDecors): void {
		prevDecorTypes = Object.values(tagColorDecors);

		const doc = editor.document;
		if (!MemoEngine.isDocWatched(doc)) return;
		const memos = MemoEngine.getMemosInDoc(doc);

		const tagGroups = <{ [tag: string]: MemoEngine.Memo[] }>Aux.object.group(memos, "tag");
		for (const [tag, tagMemos] of Object.entries(tagGroups)) {
			const tagRanges = tagMemos.map((memo) => {
				const opener = memo.raw.match(/.*?mo[\t ]+/i)[0];
				const start = doc.positionAt(memo.offset + opener.length);
				const end = start.translate(0, memo.tag.length);
				return new Range(start, end);
			});
			editor.setDecorations(tagColorDecors[tag], tagRanges);
		}

		const memoRanges = memos.map((memo) => {
			const start = doc.positionAt(memo.offset);
			const end = start.translate(0, memo.length);
			return new Range(start, end);
		});
		editor.setDecorations(fontWeightDecor, memoRanges);

		decoratedEditors.add(editor);
	}

	/**
	 * Removes previous decors from `editor`
	 */
	function removePrevDecors(editor: TextEditor): void {
		for (const decorType of Object.values(prevDecorTypes)) editor.setDecorations(decorType, []);
		editor.setDecorations(fontWeightDecor, []);
	}

	/**
	 * @returns tags mapped to their corresponding color-decor-types
	 */
	async function getTagDecors(): Promise<TagColorDecors> {
		const tagColors = await MemoEngine.getTagColors();
		const tagDecors: TagColorDecors = {};
		for (const [tag, themeColor] of Object.entries(tagColors)) {
			tagDecors[tag] = window.createTextEditorDecorationType({
				color: themeColor,
			});
		}
		return tagDecors;
	}
}
