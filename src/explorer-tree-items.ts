import {
	MarkdownString,
	Position,
	Range,
	Selection,
	TextDocument,
	ThemeColor,
	ThemeIcon,
	TreeItem,
	TreeItemCollapsibleState,
	TreeItemLabel,
	Uri,
	window,
	workspace,
} from "vscode";
import { ExplorerTreeView, ExplorerViewProvider } from "./explorer-view-provider";
import { MemoEntry, MemoFetcher } from "./memo-fetcher";
import { Aux } from "./utils/auxiliary";
import { getColorMaid } from "./utils/color-maid";
import { getConfigMaid } from "./utils/config-maid";
import { FE } from "./utils/file-edit";

export namespace ETItems {
	const configMaid = getConfigMaid();
	const colorMaid = getColorMaid();

	configMaid.listen("actions.askForConfirmationOnCompletionOfMemo");
	configMaid.listen("actions.timeoutOfConfirmationOnCompletionOfMemo");
	configMaid.listen("actions.alwaysOpenChangedFileOnCompletionOfMemo");
	configMaid.listen("actions.askForConfirmationOnCompletionOfMemos");
	configMaid.listen("actions.removeLineIfMemoIsOnSingleLine");

	export type InnerItemType = FileItem | TagItem;
	export type ExplorerTreeItemType = ExplorerTreeItem | FileItem | TagItem | MemoItem;

	class ExplorerTreeItem extends TreeItem {
		constructor(label: string, expand: boolean | "none", public parent?: InnerItemType) {
			let collapsibleState;
			if (expand === "none") collapsibleState = TreeItemCollapsibleState.None;
			else collapsibleState = expand ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed;
			super(label, collapsibleState);
		}

		removeFromTree(viewProvider: ExplorerViewProvider): InnerItemType | undefined {
			if (!this.parent) {
				viewProvider.removeItems(<InnerItemType><unknown>this);
				return;
			}
			this.parent.removeChildren(this);
			if (this.parent.children.length === 0) return this.parent.removeFromTree(viewProvider);
			return this.parent;
		}
	}

	class InnerItem extends ExplorerTreeItem {
		static waitingForCompletionConfirmationIcon = new ThemeIcon("loading~spin");

		children: ExplorerTreeItem[] = [];
		hierarchy: "primary" | "secondary";

		constructor(label: string, expand: boolean, context: string, parent?: InnerItemType) {
			super(label, expand, parent);
			this.contextValue = context;
			this.hierarchy = parent ? "secondary" : "primary";
		}

		removeChildren(...children: ExplorerTreeItem[]): void {
			for (const child of children) {
				if (!this.children.includes(child)) continue;
				const childIndex = this.children.indexOf(child);
				this.children = this.children.filter((_, i) => i !== childIndex);
			}
		}
	
		removeAllItems(): void {
			this.children = [];
		}

		async completeMemos(
			explorerTreeView: ExplorerTreeView,
			options?: { noConfirmation?: boolean; _noExtraTasks?: boolean },
		): Promise<void> {
			const { memoFetcher, viewProvider } = explorerTreeView;
			memoFetcher.suppressForceScan();
			const memoEntries = (
				this.hierarchy === "primary"
					? this.children.flatMap((child) => (<InnerItemType>child).children)
					: this.children
			).map((memoItem) => (<ETItems.MemoItem>memoItem).memoEntry);

			if (!options?.noConfirmation && configMaid.get("actions.askForConfirmationOnCompletionOfMemos")) {
				const iconPath = this.iconPath;
				this.iconPath = InnerItem.waitingForCompletionConfirmationIcon;
				viewProvider.refresh(this);

				const completionDetails = `Are you sure you want to proceed?
					This will mark all ${memoEntries.length} memo${Aux.plural(memoEntries)} ${
					this.contextValue === "File" ? "in" : "under"
				} the ${this.contextValue.toLowerCase()} ${this.label} as completed.`;
				const option = await window.showInformationMessage(
					"Confirm Completion of Memos",
					{ modal: true, detail: completionDetails },
					"Yes",
					"No",
				);
				this.iconPath = iconPath;
				viewProvider.refresh(this);
				if (!option || option === "No") {
					memoFetcher.unsuppressForceScan();
					return;
				}
			}

			const edit = new FE.FileEdit();
			const docs = new Set();
			for (const memoEntry of memoEntries) {
				await workspace.openTextDocument(memoEntry.path).then(async (doc) => {
					docs.add(doc);
					const doRemoveLine =
						configMaid.get("actions.removeLineIfMemoIsOnSingleLine") &&
						memoEntry.line < doc.lineCount - 1 &&
						doc
							.lineAt(memoEntry.line)
							.text.replace(
								new RegExp(
									`${Aux.reEscape(memoEntry.raw)}|${Aux.reEscape(
										MemoFetcher.getFormattedMemo(memoEntry),
									)}`,
								),
								"",
							)
							.trim().length === 0;
					const start = doc.positionAt(memoEntry.offset);
					const end = doRemoveLine
						? new Position(memoEntry.line + 1, 0)
						: start.translate(0, memoEntry.rawLength);
					const range = new Range(start, end);
					edit.delete(doc.uri, range);
				});
			}
			await edit.apply({ isRefactoring: true });
			if (options?._noExtraTasks) return;
			setTimeout(() => {
				memoFetcher.removeMemos(...memoEntries);
				viewProvider.reloadItems();
			}, 100);
		}
	}

	export class FileItem extends InnerItem {
		constructor(readonly path: string, expand: boolean, parent?: TagItem) {
			super(workspace.asRelativePath(path), expand, "File", parent);
			this.resourceUri = Uri.file(path);
			this.iconPath = ThemeIcon.File;
		}

		navigate(): void {
			workspace.openTextDocument(this.path).then((doc) => {
				window.showTextDocument(doc).then((editor) => {
					let pos = doc.lineAt(0).range.end;
					editor.selection = new Selection(pos, pos);
					editor.revealRange(new Range(pos, pos));
				});
			});
		}
	}

	export class TagItem extends InnerItem {
		constructor(tag: string, expand: boolean, parent?: FileItem) {
			super(tag, expand, "Tag", parent);
		}
	}

	export class MemoItem extends ExplorerTreeItem {
		static currentCompletionConfirmationTarget?: MemoItem;
		static currentCompletionConfirmationBackup?: {
			label: string | TreeItemLabel;
			description: string | boolean;
			iconPath:
				| string
				| Uri
				| {
						light: string | Uri;
						dark: string | Uri;
				  }
				| ThemeIcon;
			contextValue: string;
		};

		attemptedToComplete?: boolean;
		confirmInterval?: NodeJS.Timeout;
		confirmTimeout?: NodeJS.Timeout;

		constructor(public memoEntry: MemoEntry, parent: InnerItem, tagColor: ThemeColor, maxPriority: number) {
			const content = memoEntry.content === "" ? "Placeholder T^T" : memoEntry.content;
			super(content, "none", parent);
			this.description = `Ln ${memoEntry.line + 1}`;
			this.tooltip = new MarkdownString(
				`${memoEntry.tag} ~ *${memoEntry.relativePath}* - Ln ${memoEntry.line + 1}\n***\n${content}`,
			);
			this.tooltip.supportHtml = true;
			this.contextValue = "Memo";
			this.command = {
				command: "better-memo.navigateToMemo",
				title: "Navigate to Memo",
				tooltip: "Navigate to Memo",
				arguments: [this],
			};
			this.iconPath =
				memoEntry.priority === 0
					? new ThemeIcon("circle-filled", tagColor)
					: new ThemeIcon(
							"circle-outline",
							colorMaid.interpolate([255, (1 - memoEntry.priority / maxPriority) * 255, 0]),
					  );
		}

		async navigate(): Promise<void> {
			const memoEntry = this.memoEntry;
			await workspace.openTextDocument(memoEntry.path).then(async (doc) => {
				await window.showTextDocument(doc).then((editor) => {
					let pos = doc.positionAt(memoEntry.offset + memoEntry.rawLength);
					editor.selection = new Selection(pos, pos);
					editor.revealRange(new Range(pos, pos));
				});
			});
		}

		async complete(explorerTreeView: ExplorerTreeView, options?: { noConfirmation?: boolean }): Promise<void> {
			const { memoFetcher, viewProvider } = explorerTreeView;
			memoFetcher.unsuppressForceScan();
			if (
				!options?.noConfirmation &&
				configMaid.get("actions.askForConfirmationOnCompletionOfMemo") &&
				!this.completionConfirmationHandle(explorerTreeView, { words: 3, maxLength: 12 })
			)
				return;
			const memoEntry = this.memoEntry;
			await workspace.openTextDocument(memoEntry.path).then(async (doc) => {
				const doRemoveLine =
					configMaid.get("actions.removeLineIfMemoIsOnSingleLine") &&
					memoEntry.line < doc.lineCount - 1 &&
					doc
						.lineAt(memoEntry.line)
						.text.replace(
							new RegExp(
								`${Aux.reEscape(memoEntry.raw)}|${Aux.reEscape(
									MemoFetcher.getFormattedMemo(memoEntry),
								)}`,
							),
							"",
						)
						.trim().length === 0;
				const doOpenFile = configMaid.get("actions.alwaysOpenChangedFileOnCompletionOfMemo");
				const start = doc.positionAt(memoEntry.offset);
				const end = doRemoveLine
					? new Position(memoEntry.line + 1, 0)
					: start.translate(0, memoEntry.rawLength);
				const range = new Range(start, end);
				const edit = new FE.FileEdit();
				edit.delete(doc.uri, range);
				viewProvider.refresh(this.removeFromTree(viewProvider));
				await edit.apply({ isRefactoring: true }, doOpenFile).then(() => {
					const editor = window.activeTextEditor;
					if (editor?.document === doc) {
						editor.revealRange(new Range(start, start));
						editor.selection = new Selection(start, start);
					}
				});
			});
		}

		private completionConfirmationHandle(
			explorerTreeView: ExplorerTreeView,
			labelOptions: { words?: number; maxLength: number },
		): boolean {
			function setConfirmingItem(item: MemoItem) {
				MemoItem.currentCompletionConfirmationTarget = currentTarget = item;
				MemoItem.currentCompletionConfirmationBackup = {
					label: item.label,
					description: item.description,
					iconPath: item.iconPath,
					contextValue: item.contextValue,
				};
			}

			function reset(confirmingItem: MemoItem, noRefresh?: boolean) {
				explorerTreeView.memoFetcher.unsuppressForceScan();
				clearInterval(confirmingItem.confirmInterval);
				clearTimeout(confirmingItem.confirmTimeout);
				confirmingItem.attemptedToComplete = false;
				[
					confirmingItem.label,
					confirmingItem.description,
					confirmingItem.iconPath,
					confirmingItem.contextValue,
				] = [
					currentBackup.label,
					currentBackup.description,
					currentBackup.iconPath,
					currentBackup.contextValue,
				];
				if (noRefresh) return;
				explorerTreeView.viewProvider.refresh(confirmingItem);
			}

			let currentTarget = MemoItem.currentCompletionConfirmationTarget;
			const currentBackup = MemoItem.currentCompletionConfirmationBackup;
			if (!currentTarget) setConfirmingItem(this);

			if (this !== currentTarget) {
				reset(currentTarget);
				setConfirmingItem(this);
			}

			if (this.attemptedToComplete) {
				reset(this, true);
				return true;
			}
			this.attemptedToComplete = true;

			let abbrevLabel = `${this.label
				.toString()
				.split(/\s/, labelOptions.words ?? 1)
				.join(" ")}`;
			if (abbrevLabel.length > labelOptions.maxLength)
				abbrevLabel = `${abbrevLabel.slice(0, labelOptions.maxLength)}...`;
			this.label = abbrevLabel;
			this.contextValue = "MemoWaitingForCompletionConfirmation";

			explorerTreeView.memoFetcher.suppressForceScan();
			const timeout = configMaid.get("actions.timeoutOfConfirmationOnCompletionOfMemo");
			let time = timeout;
			const updateTime = (time: number) => {
				this.description = `Confirm in ${Math.round(time / 1000)}`;
				const gbVal = (255 * time) / timeout;
				this.iconPath = new ThemeIcon("loading~spin", colorMaid.interpolate([255, gbVal, gbVal]));
				explorerTreeView.viewProvider.refresh(this);
			};
			updateTime(timeout);
			this.confirmInterval = setInterval(() => updateTime((time -= 1000)), timeout / Math.round(time / 1000));

			this.confirmTimeout = setTimeout(() => {
				reset(this);
				MemoItem.currentCompletionConfirmationTarget = null;
				MemoItem.currentCompletionConfirmationBackup = null;
			}, timeout);
			return false;
		}
	}
}
