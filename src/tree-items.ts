import {
	MarkdownString,
	Position,
	Range,
	Selection,
	ThemeColor,
	ThemeIcon,
	TreeItem,
	TreeItemCollapsibleState,
	TreeItemLabel,
	Uri,
	window,
	workspace,
} from "vscode";
import { TreeView, ViewProvider } from "./tree-view";
import { MemoEntry } from "./memo-fetcher";
import { Aux } from "./utils/auxiliary";
import { ColorMaid, getColorMaid } from "./utils/color-maid";
import { ConfigMaid } from "./utils/config-maid";
import { FEdit } from "./utils/file-edit";

let colorMaid: ColorMaid;
let configMaid: ConfigMaid;

export namespace TreeItems {
	export type InnerItemType = FileItem | TagItem;
	export type TreeItemType = ExplorerTreeItem | FileItem | TagItem | MemoItem;

	class ExplorerTreeItem extends TreeItem {
		constructor(label: string, expand: boolean | "none", public parent?: InnerItemType) {
			if (!resolved) throw moduleUnresolvedError;

			let collapsibleState: TreeItemCollapsibleState;
			if (expand === "none") collapsibleState = TreeItemCollapsibleState.None;
			else collapsibleState = expand ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed;
			super(label, collapsibleState);
		}

		async removeFromTree(viewProvider: ViewProvider): Promise<InnerItemType | undefined> {
			if (!this.parent) {
				await viewProvider.removeItems(<InnerItemType>(<unknown>this));
				return;
			}
			await this.parent.removeChildren(this);
			if (this.parent.children.length === 0) return await this.parent.removeFromTree(viewProvider);
			return this.parent;
		}
	}

	class InnerItem extends ExplorerTreeItem {
		static waitingForCompletionConfirmationIcon = new ThemeIcon("loading~spin");

		children: ExplorerTreeItem[] = [];
		hierarchy: "primary" | "secondary";

		constructor(label: string, expand: boolean, context: string, parent?: InnerItemType) {
			if (!resolved) throw moduleUnresolvedError;

			super(label, expand, parent);
			this.contextValue = context;
			this.hierarchy = parent ? "secondary" : "primary";
		}

		async removeChildren(...children: ExplorerTreeItem[]): Promise<void> {
			for (const child of children) {
				if (!this.children.includes(child)) continue;
				const childIndex = this.children.indexOf(child);
				this.children = this.children.filter((_, i) => i !== childIndex);
			}
		}

		async completeMemos(
			treeView: TreeView,
			options?: { noConfirmation?: boolean; _noExtraTasks?: boolean },
		): Promise<void> {
			const { memoFetcher, viewProvider } = treeView;
			await memoFetcher.suppressForceScan();
			const memoEntries = await Promise.all(
				(this.hierarchy === "primary"
					? this.children.flatMap((child) => (<InnerItemType>child).children)
					: this.children
				).map(async (memoItem) => (<TreeItems.MemoItem>memoItem).memoEntry),
			);

			if (!options?.noConfirmation && (await configMaid.get("actions.askForConfirmationOnCompletionOfMemos"))) {
				const iconPath = this.iconPath;
				this.iconPath = InnerItem.waitingForCompletionConfirmationIcon;
				await viewProvider.refresh(this);

				const completionDetails = `Are you sure you want to proceed?
					This will mark all ${memoEntries.length} memo${await Aux.plural(memoEntries)} ${
					this.contextValue === "File" ? "in" : "under"
				} the ${this.contextValue.toLowerCase()} ${this.label} as completed.`;
				const option = await window.showInformationMessage(
					"Confirm Completion of Memos",
					{ modal: true, detail: completionDetails },
					"Yes",
					"No",
				);

				this.iconPath = iconPath;
				await viewProvider.refresh(this);
				if (!option || option === "No") {
					await memoFetcher.unsuppressForceScan();
					return;
				}
			}

			const edit = new FEdit.FileEdit();
			for (const memoEntry of memoEntries) {
				await workspace.openTextDocument(memoEntry.path).then(async (doc) => {
					const doRemoveLine =
						(await configMaid.get("actions.removeLineIfMemoIsOnSingleLine")) &&
						memoEntry.line < doc.lineCount - 1 &&
						doc
							.lineAt(memoEntry.line)
							.text.replace(
								RegExp(
									`(?:${await Aux.reEscape(memoEntry.raw)})|(?:${await Aux.reEscape(
										await memoFetcher.getFormattedMemo(memoEntry),
									)})`,
								),
								"",
							)
							.trim().length === 0;
					const start = doc.positionAt(memoEntry.offset);
					const end = doRemoveLine
						? new Position(memoEntry.line + 1, 0)
						: start.translate(0, memoEntry.rawLength);
					const range = new Range(start, end);
					await edit.delete(doc.uri, range);
				});
			}
			await edit.apply({ isRefactoring: true });
			if (options?._noExtraTasks) return;
			await memoFetcher.suppressForceScan();
			await memoFetcher.removeMemos(...memoEntries);
			await viewProvider.reloadItems();
			memoFetcher.unsuppressForceScan();
		}
	}

	export class FileItem extends InnerItem {
		constructor(readonly path: string, expand: boolean, parent?: TagItem) {
			if (!resolved) throw moduleUnresolvedError;

			super(workspace.asRelativePath(path), expand, "File", parent);
			this.resourceUri = Uri.file(path);
			this.iconPath = ThemeIcon.File;
		}

		async navigate(): Promise<void> {
			await workspace.openTextDocument(this.path).then(async (doc) => {
				await window.showTextDocument(doc).then(async (editor) => {
					let pos = doc.lineAt(0).range.end;
					editor.selection = new Selection(pos, pos);
					editor.revealRange(new Range(pos, pos));
				});
			});
		}
	}

	export class TagItem extends InnerItem {
		constructor(tag: string, expand: boolean, parent?: FileItem) {
			if (!resolved) throw moduleUnresolvedError;

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

		constructor(public memoEntry: MemoEntry, parent: InnerItem) {
			if (!resolved) throw moduleUnresolvedError;

			const content = memoEntry.content === "" ? "Placeholder T^T" : memoEntry.content;
			super(content, "none", parent);
			this.description = `Ln ${memoEntry.line + 1}`;
			this.tooltip = new MarkdownString(
				`${memoEntry.tag} ~ *${memoEntry.relativePath}* - Ln ${memoEntry.line + 1}\n***\n${content}`,
			);
			this.contextValue = "Memo";
			this.command = {
				command: "better-memo.navigateToMemo",
				title: "Navigate to Memo",
				tooltip: "Navigate to Memo",
				arguments: [this],
			};
		}

		async setIcon(tagColor: ThemeColor, maxPriority: number): Promise<void> {
			this.iconPath =
				this.memoEntry.priority === 0
					? new ThemeIcon("circle-filled", tagColor)
					: new ThemeIcon(
							"circle-outline",
							await colorMaid.interpolate([255, (1 - this.memoEntry.priority / maxPriority) * 255, 0]),
					  );
		}

		async navigate(): Promise<void> {
			const memoEntry = this.memoEntry;
			await workspace.openTextDocument(memoEntry.path).then(
				async (doc) =>
					await window.showTextDocument(doc).then((editor) => {
						let pos = doc.positionAt(memoEntry.offset + memoEntry.rawLength);
						editor.selection = new Selection(pos, pos);
						editor.revealRange(new Range(pos, pos));
					}),
			);
		}

		async complete(treeView: TreeView, options?: { noConfirmation?: boolean }): Promise<void> {
			const { memoFetcher, viewProvider } = treeView;
			await memoFetcher.unsuppressForceScan();
			if (
				!options?.noConfirmation &&
				(await configMaid.get("actions.askForConfirmationOnCompletionOfMemo")) &&
				!(await this.completionConfirmationHandle(treeView, { words: 3, maxLength: 12 }))
			)
				return;
			const memoEntry = this.memoEntry;
			await workspace.openTextDocument(memoEntry.path).then(async (doc) => {
				memoFetcher.scanDoc(doc);
				if (!memoFetcher.includes(memoEntry)) {
					await viewProvider.reloadItems();
					return;
				}
				const doRemoveLine =
					(await configMaid.get("actions.removeLineIfMemoIsOnSingleLine")) &&
					memoEntry.line < doc.lineCount - 1 &&
					doc
						.lineAt(memoEntry.line)
						.text.replace(
							RegExp(
								`${await Aux.reEscape(memoEntry.raw)}|${await Aux.reEscape(
									await memoFetcher.getFormattedMemo(memoEntry),
								)}`,
							),
							"",
						)
						.trim().length === 0;
				const doOpenFile = await configMaid.get("actions.alwaysOpenChangedFileOnCompletionOfMemo");
				const start = doc.positionAt(memoEntry.offset);
				const end = doRemoveLine
					? new Position(memoEntry.line + 1, 0)
					: start.translate(0, memoEntry.rawLength);
				const range = new Range(start, end);
				const edit = new FEdit.FileEdit();
				await edit.delete(doc.uri, range);
				viewProvider.refresh(await this.removeFromTree(viewProvider));
				await edit.apply({ isRefactoring: true }, doOpenFile).then(async () => {
					const editor = window.activeTextEditor;
					if (editor?.document === doc) {
						editor.revealRange(new Range(start, start));
						editor.selection = new Selection(start, start);
					}
				});
			});
		}

		private async completionConfirmationHandle(
			treeView: TreeView,
			labelOptions: { words?: number; maxLength: number },
		): Promise<boolean> {
			const setConfirmingItem = async (item: MemoItem) => {
				MemoItem.currentCompletionConfirmationTarget = currentTarget = item;
				MemoItem.currentCompletionConfirmationBackup = {
					label: item.label,
					description: item.description,
					iconPath: item.iconPath,
					contextValue: item.contextValue,
				};
			};
			const reset = async (confirmingItem: MemoItem, options?: { noRefresh?: boolean }) => {
				await treeView.memoFetcher.unsuppressForceScan();
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
				if (options?.noRefresh) return;
				await treeView.viewProvider.refresh(confirmingItem);
			};

			let currentTarget = MemoItem.currentCompletionConfirmationTarget;
			const currentBackup = MemoItem.currentCompletionConfirmationBackup;
			if (!currentTarget) await setConfirmingItem(this);

			if (this !== currentTarget) {
				await reset(currentTarget);
				await setConfirmingItem(this);
			}

			if (this.attemptedToComplete) {
				await reset(this, { noRefresh: true });
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

			await treeView.memoFetcher.suppressForceScan();
			const timeout = await configMaid.get("actions.timeoutOfConfirmationOnCompletionOfMemo");
			let time = timeout;
			const updateTime = async (time: number) => {
				this.description = `Confirm in ${Math.round(time / 1000)}`;
				const gbVal = (255 * time) / timeout;
				this.iconPath = new ThemeIcon("loading~spin", await colorMaid.interpolate([255, gbVal, gbVal]));
				treeView.viewProvider.refresh(this);
			};
			await updateTime(timeout);
			this.confirmInterval = setInterval(
				async () => await updateTime((time -= 1000)),
				timeout / Math.round(time / 1000),
			);

			this.confirmTimeout = setTimeout(async () => {
				await reset(this);
				MemoItem.currentCompletionConfirmationTarget = null;
				MemoItem.currentCompletionConfirmationBackup = null;
			}, timeout);
			return false;
		}
	}
}

let resolved = false;
const moduleUnresolvedError = new Error("module tree-items is not resolved");
export async function resolver(): Promise<void> {
	if (resolved) return;
	resolved = true;

	colorMaid = await getColorMaid();
	configMaid = new ConfigMaid();

	await Promise.all([
		configMaid.listen("actions.askForConfirmationOnCompletionOfMemo"),
		configMaid.listen("actions.timeoutOfConfirmationOnCompletionOfMemo"),
		configMaid.listen("actions.alwaysOpenChangedFileOnCompletionOfMemo"),
		configMaid.listen("actions.askForConfirmationOnCompletionOfMemos"),
		configMaid.listen("actions.removeLineIfMemoIsOnSingleLine"),
	]);
}