import {
	MarkdownString,
	Position,
	Range,
	Selection,
	ThemeIcon,
	TreeItemCollapsibleState,
	Uri,
	TreeItem as VSTreeItem,
	window,
	workspace,
} from "vscode";

import { Memo } from "../engine/memo";
import { Tag } from "../engine/tag";
import { Aux } from "../utils/auxiliary";
import { Colors } from "../utils/colors";
import { FileEdit } from "../utils/file-edit";

export namespace TreeItem {
	export type PrimaryType = TagItem<"primary"> | FileItem<"primary">;

	export type SecondaryType = TagItem<"secondary"> | FileItem<"secondary">;

	export type InnerType = PrimaryType | SecondaryType;

	export type MemoType = MemoItem<"tag"> | MemoItem<"file">;

	export type ItemType = InnerType | MemoType;

	class ExplorerItem<
		P extends undefined | ExplorerItem<undefined | ExplorerItem<undefined>>,
	> extends VSTreeItem {
		constructor(
			public label: string,
			expand: boolean | null,
			public parent: P,
		) {
			super(
				label,
				expand === null
					? TreeItemCollapsibleState.None
					: expand
					? TreeItemCollapsibleState.Expanded
					: TreeItemCollapsibleState.Collapsed,
			);
		}
	}

	class InnerItem<
		P extends undefined | InnerItem<undefined>,
	> extends ExplorerItem<P> {
		children: (P extends undefined
			? TagItem<"secondary"> | FileItem<"secondary">
			: MemoItem<"tag" | "file">)[] = [];

		constructor(
			public contextValue: "tag" | "file",

			label: string,
			expand: boolean,
			parent: P,
		) {
			super(label, expand, parent);
		}

		async complete(
			edit: FileEdit.Edit = new FileEdit.Edit(),
			options?: { noConfirm?: boolean },
		): Promise<FileEdit.Edit> {
			const memos = (
				this.children as (TagItem<"secondary"> | FileItem<"secondary">)[]
			).flatMap((child) => child.children);

			if (!options?.noConfirm) {
				const prompt = `Are you sure you want to proceed?
					This will mark all ${memos.length} memo${Aux.string.plural(memos)} ${
					this.contextValue === "tag" ? "of" : "in"
				} the ${this.contextValue} ${this.label} as completed.`;

				const confirm = await window.showInformationMessage(
					"Confirm Completion of Memos",
					{ modal: true, detail: prompt },
					"Yes",
				);
				if (!confirm) return edit;
			}

			for (const memo of memos) memo.complete(edit);
			return edit;
		}
	}

	export class TagItem<T extends "primary" | "secondary"> extends InnerItem<
		T extends "primary" ? undefined : FileItem<"primary">
	> {
		constructor(
			tag: string,

			expand: boolean,
			parent: T extends "primary" ? undefined : FileItem<"primary">,
		) {
			super("tag", tag, expand, parent);

			this.iconPath = new ThemeIcon("bookmark", Tag.data.colors[tag]);
		}
	}

	export class FileItem<T extends "primary" | "secondary"> extends InnerItem<
		T extends "primary" ? undefined : TagItem<"primary">
	> {
		iconPath = ThemeIcon.File;

		constructor(
			public resourceUri: Uri,

			expand: boolean,
			parent: T extends "primary" ? undefined : TagItem<"primary">,
		) {
			const path = workspace.asRelativePath(resourceUri);

			super("file", path, expand, parent);
		}

		async navigate(): Promise<void> {
			const editor = await window.showTextDocument(this.resourceUri);

			const pos = editor.document.lineAt(0).range.end;

			editor.selection = new Selection(pos, pos);
			editor.revealRange(new Range(pos, pos));
		}
	}

	export class MemoItem<T extends "tag" | "file"> extends ExplorerItem<
		T extends "tag" ? TagItem<"secondary"> : FileItem<"secondary">
	> {
		contextValue = "memo";

		command = {
			title: "Navigate to Memo",
			command: "better-memo.navigateToMemo",
			arguments: [() => this.navigate()],
		};

		constructor(
			public memo: Memo.Memo,
			urgency: number,

			parent: T extends "tag" ? TagItem<"secondary"> : FileItem<"secondary">,
		) {
			super(memo.content, null, parent);

			this.description = `Ln ${memo.meta.line + 1}`;

			this.tooltip = new MarkdownString(
				`$(bookmark) ${memo.tag} $(file) ${memo.meta.path} $(dash) Ln ${
					memo.meta.line + 1
				}\n\n---\n${memo.content === "" ? "Placeholder" : memo.content}`,
				true,
			);

			this.iconPath =
				urgency === 0
					? new ThemeIcon("circle-filled", Tag.data.colors[memo.tag])
					: new ThemeIcon(
							"circle-outline",
							Colors.interpolate([255, (1 - urgency) * 255, 0]),
					  );
		}

		async navigate(): Promise<void> {
			const memo = this.memo;

			const editor = await window.showTextDocument(memo.meta.doc);

			const pos = memo.meta.end;

			editor.selection = new Selection(pos, pos);
			editor.revealRange(new Range(pos, pos));
		}

		complete(edit: FileEdit.Edit = new FileEdit.Edit()): FileEdit.Edit {
			const memo = this.memo;
			const doc = memo.meta.doc;

			const removeLine =
				memo.meta.line < doc.lineCount - 1 &&
				doc.lineAt(memo.meta.line).firstNonWhitespaceCharacterIndex ===
					memo.meta.start.character;

			const start = removeLine
				? doc.lineAt(memo.meta.line).range.start
				: memo.meta.start;
			const end = removeLine
				? new Position(memo.meta.line + 1, 0)
				: memo.meta.end;

			return edit.delete(doc, new Range(start, end));
		}
	}
}
