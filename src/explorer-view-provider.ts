import * as vscode from "vscode";
import { Aux } from "./utils/auxiliary";
import { EE } from "./utils/event-emitter";
import { FE } from "./utils/file-edit";
import { getConfigMaid } from "./utils/config-maid";
import { getColorMaid } from "./utils/color-maid";
import { Janitor } from "./utils/janitor";
import { MemoFetcher, MemoEntry, getFormattedMemo } from "./memo-fetcher";

const eventEmitter = EE.getEventEmitter();
const configMaid = getConfigMaid();
const colorMaid = getColorMaid();

type InnerItemType = FileItem | TagItem;
type ExplorerTreeItemType = ExplorerTreeItem | FileItem | TagItem | MemoItem;

export class ExplorerTreeView {
	memoFetcher: MemoFetcher;
	viewProvider: ExplorerViewProvider;

	private view: vscode.TreeView<ExplorerTreeItemType>;
	private janitor = new Janitor();

	async init(memoFetcher: MemoFetcher): Promise<void> {
		configMaid.listen("view.defaultView");
		configMaid.listen("view.expandPrimaryItemsByDefault");
		configMaid.listen("view.expandSecondaryItemsByDefault");
		configMaid.listen("view.askForConfirmationOnCompletionOfMemo");
		configMaid.listen("view.askForConfirmationOnCompletionOfAllMemos");
		configMaid.listen("view.timeoutOfConfirmationOnCompletionOfMemo");

		configMaid.listen("actions.alwaysOpenChangedFileOnCompletionOfMemo");
		configMaid.listen("actions.removeLineIfMemoIsOnSingleLine");

		this.memoFetcher = memoFetcher;
		this.viewProvider = new ExplorerViewProvider(memoFetcher);
		this.updateViewType(null, true);
		await this.viewProvider.init();
		this.view = vscode.window.createTreeView("better-memo.memoExplorer", {
			treeDataProvider: this.viewProvider,
			showCollapseAll: true,
			canSelectMany: false,
		});

		this.janitor.add(
			this.view,

			configMaid.onChange("view.defaultView", (view) => this.updateViewType(view)),
			configMaid.onChange(["view.expandPrimaryItemsByDefault", "view.expandSecondaryItemsByDefault"], () =>
				eventEmitter.emit("updateItemCollapsibleState"),
			),

			eventEmitter.subscribe("updateView", () => this.viewProvider.reloadItems()),
			eventEmitter.subscribe("updateItemCollapsibleState", () => this.updateItemCollapsibleState()),

			vscode.window.onDidChangeActiveColorTheme(() => this.viewProvider.reloadItems()),

			vscode.commands.registerCommand("better-memo.explorerExpandAll", () => this.explorerExpandAll()),
			vscode.commands.registerCommand("better-memo.switchToFileView", () => this.updateViewType("File")),
			vscode.commands.registerCommand("better-memo.switchToTagView", () => this.updateViewType("Tag")),

			vscode.commands.registerCommand("better-memo.navigateToMemo", (memo) => this.navigateToMemo(memo)),
			vscode.commands.registerCommand("better-memo.navigateToFile", (file) => file.navigate()),

			vscode.commands.registerCommand("better-memo.completeMemo", (memo) => memo.complete(this)),
			vscode.commands.registerCommand("better-memo.confirmCompleteMemo", (memo) => memo.complete(this)),
			vscode.commands.registerCommand("better-memo.completeMemoNoConfirm", (memo) => memo.complete(this, true)),
		);

		vscode.commands.executeCommand("setContext", "better-memo.explorerInitFinished", true);
	}

	dispose(): void {
		this.janitor.clearAll();
	}

	private explorerExpandAll() {
		for (const item of this.viewProvider.items) this.view.reveal(item, { select: false, expand: 2 });
	}

	private updateViewType(view?: "File" | "Tag", noReload?: boolean): void {
		this.viewProvider.currentView = view = view ?? configMaid.get("view.defaultView");
		vscode.commands.executeCommand("setContext", "better-memo.explorerView", view);
		if (noReload) return;
		this.viewProvider.reloadItems();
	}

	private navigateToMemo(memo: MemoEntry): void {
		vscode.workspace.openTextDocument(memo.path).then((doc) => {
			vscode.window.showTextDocument(doc).then((editor) => {
				let pos = doc.positionAt(memo.offset + memo.rawLength);
				editor.selection = new vscode.Selection(pos, pos);
				editor.revealRange(new vscode.Range(pos, pos));
			});
		});
	}

	private updateItemCollapsibleState(): void {
		this.view.reveal(this.viewProvider.items[0], { select: false, focus: true }).then(() => {
			Promise.resolve(vscode.commands.executeCommand("list.collapseAll")).finally(async () => {
				if (configMaid.get("view.expandSecondaryItemsByDefault")) {
					const reveals = [];
					for (const item of this.viewProvider.items) {
						for (const child of item.children)
							reveals.push(this.view.reveal(child, { select: false, expand: true }));
					}
					await Promise.allSettled(reveals);
				}
				for (const item of this.viewProvider.items) {
					if (configMaid.get("view.expandPrimaryItemsByDefault")) {
						this.view.reveal(item, { select: false, expand: true });
						continue;
					}
					await this.view.reveal(item, { select: false, focus: true });
					vscode.commands.executeCommand("list.collapse");
				}
				this.view.reveal(this.viewProvider.items[0], {
					select: false,
					focus: true,
				});
			});
		});
	}
}

class ExplorerViewProvider implements vscode.TreeDataProvider<ExplorerTreeItemType> {
	items: InnerItemType[] = [];
	memoCount = 0;
	currentView: "File" | "Tag";

	private _onDidChangeTreeData: vscode.EventEmitter<void | undefined | ExplorerTreeItemType> =
		new vscode.EventEmitter<void | undefined | ExplorerTreeItemType>();
	readonly onDidChangeTreeData: vscode.Event<void | undefined | ExplorerTreeItemType> =
		this._onDidChangeTreeData.event;

	constructor(private memoFetcher: MemoFetcher) {}

	async init(): Promise<void> {
		await eventEmitter.wait("fetcherInitFinished").then(() => this.reloadItems());
	}

	getChildItems(): InnerItemType[] {
		return this.items;
	}

	setChildItems(items: InnerItemType[]): void {
		this.items = items;
	}

	getTreeItem(element: ExplorerTreeItemType): ExplorerTreeItemType {
		return element;
	}

	getParent(element: ExplorerTreeItemType): InnerItem {
		return element.parent;
	}

	getChildren(element: InnerItemType | undefined): ExplorerTreeItemType[] {
		if (element) return element.children;
		return this.items;
	}

	reloadItems(): void {
		this.items = this.getItems();
		this._onDidChangeTreeData.fire();
	}

	refresh(item?: ExplorerTreeItemType): void {
		this._onDidChangeTreeData.fire(item);
	}

	private getItems(): InnerItemType[] {
		const isFileView = this.currentView === "File";
		const expandPrimaryGroup = configMaid.get("view.expandPrimaryItemsByDefault");
		const expandSecondaryGroup = configMaid.get("view.expandSecondaryItemsByDefault");

		const memos = this.memoFetcher.getMemos();
		const tags = this.memoFetcher.getTags();
		const inner = Aux.groupObjects(memos, isFileView ? "path" : "tag");
		const innerLabels = Object.keys(inner).sort();
		const innerItems = innerLabels.map((label) => new (isFileView ? FileItem : TagItem)(label, expandPrimaryGroup));
		this.memoCount = memos.length;

		for (let i = 0; i < innerLabels.length; i++) {
			const innerLabel = innerLabels[i];
			const innerItem = innerItems[i];
			if (!isFileView) innerItem.iconPath = new vscode.ThemeIcon("bookmark", tags[innerLabel]);

			const halfLeaves = Aux.groupObjects(inner[innerLabel], isFileView ? "tag" : "path");
			const halfLeafLabels = Object.keys(halfLeaves).sort();
			const halfLeafItems = halfLeafLabels.map(
				(label) => new (isFileView ? TagItem : FileItem)(label, expandSecondaryGroup, innerItem),
			);
			innerItem.setChildItems(halfLeafItems);

			let childMemoCount = 0;
			for (let j = 0; j < innerItem.children.length; j++) {
				const halfLeafItem = innerItem.children[j];
				const halfLeafLabel = halfLeafLabels[j];
				if (isFileView) halfLeafItem.iconPath = new vscode.ThemeIcon("bookmark", tags[halfLeafLabel]);

				let memos = halfLeaves[halfLeafLabel].sort((a, b) => a._offset - b._offset);
				const priority = [];
				const normal = [];
				for (const memo of memos) {
					if (memo.priority !== 0) {
						priority.push(memo);
						continue;
					}
					normal.push(memo);
				}
				memos = priority.sort((a, b) => b.priority - a.priority).concat(normal);
				const tagColor = (<vscode.ThemeIcon>(isFileView ? halfLeafItem : innerItem).iconPath).color;
				const maxPriority = Math.max(...memos.map((memo) => (<MemoEntry>memo).priority));
				const memoItems = memos.map(
					(memo) => new MemoItem(<MemoEntry>memo, <InnerItemType>halfLeafItem, tagColor, maxPriority),
				);
				(<InnerItemType>halfLeafItem).setChildItems(memoItems);
				childMemoCount += memoItems.length;

				halfLeafItem.description = `${memoItems.length} Memo${Aux.plural(memoItems)}`;
				halfLeafItem.tooltip = new vscode.MarkdownString(
					`### ${isFileView ? "Tag: **" : "File: *"}${halfLeafItem.label}${isFileView ? "**" : "*"} - ${
						memoItems.length
					} $(pencil)`,
					true,
				);
			}

			innerItem.description = `${halfLeafItems.length} ${isFileView ? "Tag" : "File"}${Aux.plural(
				halfLeafItems,
			)} > ${childMemoCount} Memo${Aux.plural(childMemoCount)}`;
			innerItem.tooltip = new vscode.MarkdownString(
				`### ${isFileView ? "File: *" : "Tag: **"}${innerItem.label}${isFileView ? "*" : "**"} - ${
					halfLeafItems.length
				} ${isFileView ? "$(bookmark)" : "$(file)"} ${childMemoCount} $(pencil)`,
				true,
			);
		}
		return innerItems;
	}
}

class ExplorerTreeItem extends vscode.TreeItem {
	constructor(label: string, expand: boolean | "none", public parent?: InnerItem) {
		let collapsibleState;
		if (expand === "none") {
			collapsibleState = vscode.TreeItemCollapsibleState.None;
		} else {
			collapsibleState = expand
				? vscode.TreeItemCollapsibleState.Expanded
				: vscode.TreeItemCollapsibleState.Collapsed;
		}
		super(label, collapsibleState);
	}

	removeFromTree(viewProvider: ExplorerViewProvider): InnerItem | undefined {
		if (!this.parent) {
			viewProvider.setChildItems(viewProvider.getChildItems().filter((item) => item !== <unknown>this));
			return;
		}
		this.parent.setChildItems(this.parent.getChildItems().filter((item) => item !== this));
		if (this.parent.getChildItems().length === 0) return this.parent.removeFromTree(viewProvider);
		return this.parent;
	}
}

class InnerItem extends ExplorerTreeItem {
	children: ExplorerTreeItem[] = [];

	constructor(label: string, expand: boolean, context: string, parent?: InnerItem) {
		super(label, expand, parent);
		this.contextValue = context;
	}

	getChildItems(): ExplorerTreeItemType[] {
		return this.children;
	}

	setChildItems(items: ExplorerTreeItemType[]): void {
		this.children = items;
	}

	async completeAll(): Promise<void> {}
}

class FileItem extends InnerItem {
	constructor(readonly path: string, expand: boolean, parent?: InnerItem) {
		super(vscode.workspace.asRelativePath(path), expand, "file", parent);
		this.resourceUri = vscode.Uri.file(path);
		this.iconPath = vscode.ThemeIcon.File;
	}

	navigate(): void {
		vscode.workspace.openTextDocument(this.path).then((doc) => {
			vscode.window.showTextDocument(doc).then((editor) => {
				let pos = doc.lineAt(0).range.end;
				editor.selection = new vscode.Selection(pos, pos);
				editor.revealRange(new vscode.Range(pos, pos));
			});
		});
	}
}

class TagItem extends InnerItem {
	constructor(tag: string, expand: boolean, parent?: InnerItem) {
		super(tag, expand, "tag", parent);
	}
}

class MemoItem extends ExplorerTreeItem {
	static currentCompletionConfirmationTarget?: MemoItem;
	static currentCompletionConfirmationBackup?: {
		label: string | vscode.TreeItemLabel;
		description: string | boolean;
		iconPath:
			| string
			| vscode.Uri
			| {
					light: string | vscode.Uri;
					dark: string | vscode.Uri;
			  }
			| vscode.ThemeIcon;
		contextValue: string;
	};

	attemptedToComplete?: boolean;
	confirmInterval?: NodeJS.Timeout;
	confirmTimeout?: NodeJS.Timeout;

	constructor(public memo: MemoEntry, parent: InnerItem, tagColor: vscode.ThemeColor, maxPriority: number) {
		const content = memo.content === "" ? "Placeholder T^T" : memo.content;
		super(content, "none", parent);
		this.description = `Ln ${memo.line + 1}`;
		this.tooltip = new vscode.MarkdownString(
			`#### **${memo.tag}** ~ *${memo.relativePath}* - Ln ${memo.line + 1}\n***\n## ${content}`,
		);
		this.tooltip.supportHtml = true;
		this.contextValue = "memo";
		this.command = {
			command: "better-memo.navigateToMemo",
			title: "Navigate to Memo",
			tooltip: "Navigate to Memo",
			arguments: [memo],
		};
		this.iconPath =
			memo.priority === 0
				? new vscode.ThemeIcon("circle-filled", tagColor)
				: new vscode.ThemeIcon(
						"circle-outline",
						colorMaid.interpolate([255, (1 - memo.priority / maxPriority) * 255, 0]),
				  );
	}

	complete(explorerTreeView: ExplorerTreeView, noConfirmation?: boolean): void {
		if (
			!noConfirmation &&
			!this.completionConfirmationHandle(
				explorerTreeView,
				{ words: 3, maxLength: 12 },
				"memoWaitingForCompletionConfirmation",
			)
		)
			return;
		const memo = this.memo;
		vscode.workspace.openTextDocument(memo.path).then((doc) => {
			const removeLine =
				configMaid.get("actions.removeLineIfMemoIsOnSingleLine") &&
				memo.line < doc.lineCount - 1 &&
				doc
					.lineAt(memo.line)
					.text.replace(new RegExp(`${Aux.reEscape(memo.raw)}|${Aux.reEscape(getFormattedMemo(memo))}`), "")
					.trim().length === 0;
			const start = doc.positionAt(memo.offset);
			const end = removeLine ? new vscode.Position(memo.line + 1, 0) : start.translate(0, memo.rawLength);
			const range = new vscode.Range(start, end);
			const edit = new FE.FileEdit();
			edit.delete(doc.uri, range);
			edit.apply({ isRefactoring: true }, configMaid.get("actions.alwaysOpenChangedFileOnCompletionOfMemo")).then(
				() => {
					const editor = vscode.window.activeTextEditor;
					if (editor?.document === doc) {
						editor.revealRange(new vscode.Range(start, start));
						editor.selection = new vscode.Selection(start, start);
					}
				},
			);
			const tmp = this.removeFromTree(explorerTreeView.viewProvider);
			console.log(tmp);
			explorerTreeView.viewProvider.refresh(tmp);
		});
	}

	private completionConfirmationHandle(
		explorerTreeView: ExplorerTreeView,
		labelOptions: { words?: number; maxLength: number },
		waitingForConfirmationContext: string,
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
			[confirmingItem.label, confirmingItem.description, confirmingItem.iconPath, confirmingItem.contextValue] = [
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
		this.contextValue = waitingForConfirmationContext;

		explorerTreeView.memoFetcher.suppressForceScan();
		const timeout = configMaid.get("view.timeoutOfConfirmationOnCompletionOfMemo");
		let time = timeout;
		const updateTime = (time: number) => {
			this.description = `Confirm in ${Math.round(time / 1000)}`;
			const gbVal = (255 * time) / timeout;
			this.iconPath = new vscode.ThemeIcon("loading~spin", colorMaid.interpolate([255, gbVal, gbVal]));
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
