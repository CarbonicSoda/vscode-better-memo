import {
	MarkdownString,
	Position,
	Range,
	Selection,
	ThemeIcon,
	TreeItem,
	TreeItemCollapsibleState,
	Uri,
	window,
	workspace,
} from "vscode";

import { Engine } from "./engine";
import { Aux } from "./utils/auxiliary";
import { Colors } from "./utils/colors";
import { FileEdit } from "./utils/file-edit";

/**
 * Treeview item types and classes for {@link ExplorerView}
 */
export namespace ExplorerItems {
	/**
	 * Base class for {@link ExplorerView} tree items
	 */
	class ExplorerItem<P extends undefined | ExplorerItem<any>> extends TreeItem {
		constructor(label: string, expand: boolean | null, public parent?: P) {
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

	/**
	 * Base class for {@link ExplorerView} inner items
	 */
	class InnerItem<
		P extends undefined | InnerItem<any, any>,
		C extends
			| InnerItem<any, any>
			| MemoItem<TagItem<"secondary"> | FileItem<"secondary">>,
	> extends ExplorerItem<P> {
		children: C[] = [];

		constructor(
			public contextValue: "tag" | "file",

			label: string,
			expand: boolean,

			parent?: P,
		) {
			super(label, expand, parent);
		}

		/**
		 * Mark all memos under as completed
		 * @param options.noConfirm dont ask for confirmation
		 */
		async $complete(options?: { noConfirm?: boolean }): Promise<void> {
			const memos = this.children as MemoItem<
				TagItem<"secondary"> | FileItem<"secondary">
			>[];

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

				if (!confirm) return;
			}

			for (const memo of memos) await memo.complete();
		}
	}

	/**
	 * {@link InnerItem} representing a memo tag
	 */
	export class TagItem<T extends "primary" | "secondary"> extends InnerItem<
		T extends "primary" ? undefined : FileItem<"primary">,
		T extends "primary" ? FileItem<"secondary"> : MemoItem<TagItem<"secondary">>
	> {
		constructor(
			tag: string,

			expand: boolean,
			parent: T extends "primary" ? undefined : FileItem<"primary">,
		) {
			super("tag", tag, expand, parent);

			this.iconPath = new ThemeIcon("bookmark", Engine.tags.colors[tag]);
		}
	}

	/**
	 * {@link InnerItem} representing a watched file
	 */
	export class FileItem<T extends "primary" | "secondary"> extends InnerItem<
		T extends "primary" ? undefined : TagItem<"primary">,
		T extends "primary" ? TagItem<"secondary"> : MemoItem<FileItem<"secondary">>
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

		/**
		 * View action to navigate to the file
		 */
		async navigate(): Promise<void> {
			const editor = await window.showTextDocument(this.resourceUri);

			const pos = editor.document.lineAt(0).range.end;

			editor.selection = new Selection(pos, pos);
			editor.revealRange(new Range(pos, pos));
		}
	}

	/**
	 * Class extending {@link ExplorerItem} representing a Memo's item
	 */
	export class MemoItem<
		P extends TagItem<"secondary"> | FileItem<"secondary">,
	> extends ExplorerItem<P> {
		contextValue = "memo";

		command = {
			title: "Navigate to Memo",
			command: "better-memo.navigateToMemo",
			tooltip: "Navigate to Memo",
			arguments: [this],
		};

		constructor(
			public memo: Engine.Memo,
			urgency: number,

			parent: P,
		) {
			super(memo.content, null, parent);

			this.description = `Ln ${memo.meta.line + 1}`;

			this.tooltip = new MarkdownString(
				`${memo.tag} ~ *${memo.meta.path}* - Ln ${memo.meta.line + 1}\n***\n${
					memo.content === "" ? "Placeholder" : memo.content
				}`,
			);

			const color = Engine.tags.colors[memo.tag];
			this.iconPath =
				memo.priority === 0
					? new ThemeIcon("circle-filled", color)
					: new ThemeIcon(
							"circle-outline",
							Colors.interpolate([255, (1 - urgency) * 255, 0]),
					  );
		}

		/**
		 * View action to navigate to the memo
		 */
		async navigate(): Promise<void> {
			const memo = this.memo;

			const editor = await window.showTextDocument(memo.meta.doc.uri);

			const pos = memo.meta.end;

			editor.selection = new Selection(pos, pos);
			editor.revealRange(new Range(pos, pos));
		}

		/**
		 * Mark memo as completed
		 */
		async complete(): Promise<void> {
			const memo = this.memo;
			const doc = await workspace.openTextDocument(memo.meta.file);

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

			const edit = new FileEdit.Edit();
			edit.delete(doc.uri, new Range(start, end));
			await edit.apply();
		}
	}
}
