/**
 * Configs used in tree-items.ts:
 * actions.askForConfirmOnMemoCompletion, actions.askForConfirmOnMemosCompletion
 * actions.memoCompletionConfirmTimeout
 * actions.removeLineIfMemoSpansLine
 * actions.alwaysOpenFileOnMemoCompletion
 */

import {
	MarkdownString,
	Position,
	Range,
	Selection,
	ThemeColor,
	ThemeIcon,
	TreeItem,
	TreeItemCollapsibleState,
	Uri,
	window,
	workspace,
} from "vscode";
import { Aux } from "./utils/auxiliary";
import { ConfigMaid } from "./utils/config-maid";
import { FileEdit } from "./utils/file-edit";
import { VSColors } from "./utils/vs-colors";
import { MemoEngine } from "./memo-engine";
import { ExplorerView } from "./explorer-view";

/**
 * Treeview item types and classes for {@link ExplorerView}
 */
export namespace TreeItems {
	/**
	 * All {@link ExplorerView} tree item types
	 */
	export type TreeItemType = ExplorerItem | FileItem | TagItem | MemoItem;
	/**
	 * Inner item types (graph-theory tree concept), basically non-leaf (non-{@link MemoItem}) items
	 */
	export type InnerItemType = FileItem | TagItem;

	/**
	 * Base class for {@link ExplorerView} tree items
	 */
	class ExplorerItem extends TreeItem {
		constructor(label: string, expand: boolean | "none", public parent?: InnerItemType) {
			let collapsibleState: TreeItemCollapsibleState;
			if (expand === "none") collapsibleState = TreeItemCollapsibleState.None;
			else collapsibleState = expand ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed;

			super(label, collapsibleState);
		}

		/**
		 * Removes item from treeview, recursively removes parent if parent have lost all children
		 * @returns the upmost parent not removed from tree (still has children), `undefined` if root
		 */
		removeFromTree(): InnerItemType | undefined {
			if (!this.parent) {
				ExplorerView.removeItems(<InnerItemType>(<unknown>this));
				return;
			}
			this.parent.removeChildren(<TreeItemType>(<unknown>this));
			if (this.parent.children.length === 0) return this.parent.removeFromTree();
			return this.parent;
		}
	}

	/**
	 * Base class for {@link ExplorerView} inner items
	 */
	class InnerItem extends ExplorerItem {
		static pendingCompletionIcon = new ThemeIcon("loading~spin");

		children: TreeItemType[] = [];
		isPrimary: boolean;

		constructor(public contextValue: "File" | "Tag", label: string, expand: boolean, parent?: InnerItemType) {
			super(label, expand, parent);
			this.isPrimary = !parent;
		}

		/**
		 * Removes `children` from `this.children`
		 */
		removeChildren(...children: TreeItemType[]): void {
			this.children = Aux.array.removeFrom(this.children, ...children);
		}

		/**
		 * View action to mark all memos under `this` as completed and refreshes treeview
		 * - options.noConfirm: Don't ask for confirmation, ignoring user config;
		 */
		async markMemosAsCompleted(options?: { noConfirm?: boolean; _noExtraTasks?: boolean }): Promise<void> {
			ExplorerView.suppressUpdate();

			let memos = [];
			if (this.contextValue === "File") {
				const fileItem = <FileItem>(<unknown>this);
				const doc = await workspace.openTextDocument(fileItem.path);
				await MemoEngine.scanDoc(doc);
				memos = MemoEngine.getMemosInDoc(doc);
			} else {
				const tagItem = <TagItem>(<unknown>this);
				let filePaths = tagItem.isPrimary
					? tagItem.children.map((fileItem) => (<FileItem>fileItem).path)
					: tagItem.children.map((memoItem) => (<MemoItem>memoItem).memo.fileName);
				filePaths = [...new Set(filePaths)];
				const docs = [];
				await Aux.async.map(filePaths, async (path) => {
					const doc = await workspace.openTextDocument(path);
					docs.push(doc);
					await MemoEngine.scanDoc(doc);
				});
				memos = MemoEngine.getMemosWithTag(tagItem.tag);
			}

			if (!options?.noConfirm && ConfigMaid.get("actions.askForConfirmOnMemosCompletion")) {
				const icon = this.iconPath;
				this.iconPath = InnerItem.pendingCompletionIcon;
				ExplorerView.refresh(this);

				const completionDetails = `Are you sure you want to proceed?
					This will mark all ${memos.length} memo${Aux.string.plural(memos)} ${
					this.contextValue === "File" ? "in" : "under"
				} the ${this.contextValue.toLowerCase()} ${this.label} as completed.`;
				const option = await window.showInformationMessage(
					"Confirm Completion of Memos",
					{ modal: true, detail: completionDetails },
					"Yes",
				);

				this.iconPath = icon;
				ExplorerView.refresh(this);
				if (!option) {
					ExplorerView.unsuppressUpdate();
					return;
				}
			}

			const edit = new FileEdit.Edit();
			await Aux.async.map(memos, async (memo) => {
				const doc = await workspace.openTextDocument(memo.fileName);

				const doRemoveLine =
					ConfigMaid.get("actions.removeLineIfMemoSpansLine") &&
					memo.line < doc.lineCount - 1 &&
					doc.lineAt(memo.line).firstNonWhitespaceCharacterIndex === doc.positionAt(memo.offset).character;
				const start = doc.positionAt(memo.offset);
				const end = doRemoveLine ? new Position(memo.line + 1, 0) : start.translate(0, memo.length);
				edit.delete(doc.uri, new Range(start, end));
			});
			await edit.apply();

			if (!options?._noExtraTasks) {
				MemoEngine.forgetMemos(...memos);
				ExplorerView.refresh(this.removeFromTree());
			}
			ExplorerView.unsuppressUpdate();
		}
	}

	/**
	 * Class extending {@link InnerItem} representing a watched file's item
	 */
	export class FileItem extends InnerItem {
		constructor(readonly path: string, expand: boolean, parent?: TagItem) {
			super("File", workspace.asRelativePath(path), expand, parent);
			this.resourceUri = Uri.file(path);
			this.iconPath = ThemeIcon.File;
		}

		/**
		 * View action to navigate to the document under `this`
		 */
		async navigateTo(): Promise<void> {
			const editor = await window.showTextDocument(this.resourceUri);
			const pos = editor.document.lineAt(0).range.end;
			editor.selection = new Selection(pos, pos);
			editor.revealRange(new Range(pos, pos));
		}
	}

	/**
	 * Class extending {@link InnerItem} representing a Memo tag's item
	 */
	export class TagItem extends InnerItem {
		constructor(readonly tag: string, expand: boolean, parent?: FileItem) {
			super("Tag", tag, expand, parent);
		}
	}

	/**
	 * Class extending {@link ExplorerItem} representing a Memo's item
	 */
	export class MemoItem extends ExplorerItem {
		static currCompletionTarget?: MemoItem;
		static currCompletionState?: {
			label: string;
			description: string;
			iconPath: ThemeIcon;
			contextValue: string;
		};
		completionPending?: boolean;
		updateTimeoutInterval?: NodeJS.Timeout;
		timerCorrection?: NodeJS.Timeout;
		confirmTimeout?: NodeJS.Timeout;

		constructor(public memo: MemoEngine.Memo, tagColor: ThemeColor, parent: InnerItemType, maxPriority: number) {
			const content = memo.content === "" ? "Placeholder" : memo.content;
			super(content, "none", parent);
			this.description = `Ln ${memo.line + 1}`;
			this.tooltip = new MarkdownString(
				`${memo.tag} ~ *${memo.relativePath}* - Ln ${memo.line + 1}\n***\n${content}`,
			);
			this.contextValue = "Memo";
			this.iconPath =
				memo.priority === 0
					? new ThemeIcon("circle-filled", tagColor)
					: new ThemeIcon(
							"circle-outline",
							VSColors.interpolate([255, (1 - this.memo.priority / maxPriority) * 255, 0]),
					  );
			this.command = {
				command: "better-memo.navigateToMemo",
				title: "Navigate to Memo",
				tooltip: "Navigate to Memo",
				arguments: [this],
			};
		}

		/**
		 * View action to navigate to the Memo's position in doc
		 */
		async navigateTo(): Promise<void> {
			const memo = this.memo;
			const editor = await window.showTextDocument(Uri.file(memo.fileName));
			const pos = editor.document.positionAt(memo.offset + memo.length);
			editor.selection = new Selection(pos, pos);
			editor.revealRange(new Range(pos, pos));
		}

		/**
		 * View action to trigger Memo completion (or completion confirmation)
		 * - options.noConfirm: Ignore user config and remove Memo directly;
		 */
		async markAsCompleted(options?: { noConfirm?: boolean }): Promise<void> {
			if (
				!options?.noConfirm &&
				ConfigMaid.get("actions.askForConfirmOnMemoCompletion") &&
				!this.confirmCompletion({ words: 3, maxLength: 12 })
			)
				return;

			const memo = this.memo;
			const doc = await workspace.openTextDocument(memo.fileName);

			const doRemoveLine =
				ConfigMaid.get("actions.removeLineIfMemoSpansLine") &&
				memo.line < doc.lineCount - 1 &&
				doc.lineAt(memo.line).firstNonWhitespaceCharacterIndex === doc.positionAt(memo.offset).character;
			const start = doRemoveLine ? doc.lineAt(memo.line).range.start : doc.positionAt(memo.offset);
			const end = doRemoveLine ? new Position(memo.line + 1, 0) : start.translate(0, memo.length);

			const edit = new FileEdit.Edit();
			edit.delete(doc.uri, new Range(start, end));
			await edit.apply({
				alwaysOpenFile: ConfigMaid.get("actions.alwaysOpenFileOnMemoCompletion"),
			});
			MemoEngine.forgetMemos(memo);
			ExplorerView.refresh(this.removeFromTree());

			const editor = window.activeTextEditor;
			if (editor?.document === doc) {
				editor.selection = new Selection(start, start);
				editor.revealRange(new Range(start, start));
			}
		}

		/**
		 * Memo completion confirmation handle
		 * - labelOptions.words: Number of words to be included in label;
		 * - labelOptions.maxLength: Maximum length of label, if exceeded appends "...";
		 */
		private confirmCompletion(labelOptions: { words?: number; maxLength: number }): boolean {
			const setPendingItem = (item: MemoItem) => {
				MemoItem.currCompletionTarget = item;
				MemoItem.currCompletionState = {
					label: <string>item.label,
					description: <string>item.description,
					iconPath: <ThemeIcon>item.iconPath,
					contextValue: item.contextValue,
				};
			};
			const resetPendingItem = (item: MemoItem, options?: { noRefresh?: boolean }) => {
				clearInterval(item.updateTimeoutInterval);
				clearInterval(item.timerCorrection);
				clearTimeout(item.confirmTimeout);
				item.completionPending = false;
				({
					label: item.label,
					description: item.description,
					iconPath: item.iconPath,
					contextValue: item.contextValue,
				} = MemoItem.currCompletionState);
				ExplorerView.unsuppressUpdate();
				if (options?.noRefresh) return;
				ExplorerView.refresh(item);
			};

			const prevTarget = MemoItem.currCompletionTarget;
			if (!prevTarget) setPendingItem(this);
			else if (this !== prevTarget) {
				resetPendingItem(prevTarget);
				setPendingItem(this);
			}
			if (this.completionPending) {
				resetPendingItem(this, { noRefresh: true });
				MemoItem.currCompletionTarget = null;
				MemoItem.currCompletionState = null;
				return true;
			}
			this.completionPending = true;

			let abbrevLabel = `${this.label
				.toString()
				.split(/\s+/, labelOptions.words ?? 1)
				.join(" ")}`;
			if (abbrevLabel.length > labelOptions.maxLength)
				abbrevLabel = `${abbrevLabel.slice(0, labelOptions.maxLength)}...`;
			this.label = abbrevLabel;
			this.contextValue = "MemoCompletionPending";

			ExplorerView.suppressUpdate();
			const timeout = ConfigMaid.get("actions.memoCompletionConfirmTimeout");
			const timeSec = Math.trunc(timeout / 1e3);
			let timeLeft = timeSec;
			let time10 = 0;
			const updateTimeout = () => {
				this.description = `Confirm in ${timeLeft--}`;
				const gbValue = (255e3 * timeLeft) / timeout;
				this.iconPath = new ThemeIcon("loading~spin", VSColors.interpolate([255, gbValue, gbValue]));
				ExplorerView.refresh(this);
			};
			updateTimeout();
			this.updateTimeoutInterval = setInterval(updateTimeout, 1e3);
			this.timerCorrection = setInterval(() => (timeLeft = timeSec - 10 * ++time10), 1e4);
			this.confirmTimeout = setTimeout(() => {
				if (MemoItem.currCompletionTarget === this) {
					resetPendingItem(this);
					MemoItem.currCompletionTarget = null;
					MemoItem.currCompletionState = null;
				}
			}, timeout);

			return false;
		}
	}
}
