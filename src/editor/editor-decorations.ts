import { Range, TextEditor, TextEditorDecorationType, window } from "vscode";

import { Memo } from "../engine/memo";
import { Tag } from "../engine/tag";
import { EventEmitter } from "../utils/event-emitter";
import { Janitor } from "../utils/janitor";

export namespace EditorDecorations {
	export function init(): void {
		Janitor.add(
			window.onDidChangeVisibleTextEditors(decorateEditors),

			EventEmitter.subscribe("Update", decorateEditors),
		);

		decorateEditors();
	}

	const decorations: {
		memo: TextEditorDecorationType;
		tags: { [tag: string]: TextEditorDecorationType };
	} = {
		memo: window.createTextEditorDecorationType({}),
		tags: {},
	};
	function disposeDecorations(): void {
		decorations.memo.dispose();

		Object.values(decorations.tags).map((type) => type.dispose());
		decorations.tags = {};
	}

	function decorateEditors(
		editors: readonly TextEditor[] = window.visibleTextEditors,
	): void {
		disposeDecorations();

		decorations.memo = window.createTextEditorDecorationType({
			fontWeight: "800",
		});

		for (const editor of editors) {
			const memos = Memo.inDoc(editor.document);

			const memoRanges: Range[] = [];
			const tagRanges: Map<TextEditorDecorationType, Range[]> = new Map();

			for (const memo of memos) {
				memoRanges.push(new Range(memo.meta.start, memo.meta.end));

				const tag = memo.tag;
				decorations.tags[tag] ??= window.createTextEditorDecorationType({
					color: Tag.data.colors[tag],
				});
				const tagDecor = decorations.tags[tag];

				const head = memo.raw.match(/^.*?mo[\t ]+/i)![0];
				const tagStart = memo.meta.start.translate(0, head.length);
				const tagEnd = tagStart.translate(0, memo.tag.length);

				if (!tagRanges.get(tagDecor)) tagRanges.set(tagDecor, []);
				tagRanges.get(tagDecor)!.push(new Range(tagStart, tagEnd));
			}

			editor.setDecorations(decorations.memo, memoRanges);

			for (const [type, ranges] of tagRanges.entries()) {
				editor.setDecorations(type, ranges);
			}
		}
	}
}
