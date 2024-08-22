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
type ExplorerTreeItem = CompletableItem | InnerItemType | MemoItem;

export class ExplorerTreeView {
	memoFetcher: MemoFetcher;
	viewProvider: ExplorerViewProvider;

	private view: vscode.TreeView<ExplorerTreeItem>;
	private janitor = new Janitor();

	async init(memoFetcher: MemoFetcher): Promise<void> {
		configMaid.listen("view.defaultView");
		configMaid.listen("view.expandPrimaryByDefault");
		configMaid.listen("view.expandSecondaryByDefault");
		configMaid.listen("view.confirmCompleteMemo");
		configMaid.listen("view.confirmCompleteMultiple");
		configMaid.listen("view.confirmCompleteTimeout");
		configMaid.listen("view.alwaysOpenFileOnCompleteSingleMemo");

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
			configMaid.onChange(["view.expandPrimaryByDefault", "view.expandSecondaryByDefault"], () =>
				eventEmitter.emit("updateItemCollapsibleState"),
			),

			eventEmitter.subscribe("updateView", () => this.viewProvider.reloadItems()),
			eventEmitter.subscribe("updateItemCollapsibleState", () => this.updateItemCollapsibleState()),

			vscode.commands.registerCommand("better-memo.explorerExpandAll", () => {
				for (const item of this.viewProvider.items) this.view.reveal(item, { select: false, expand: 2 });
			}),
			vscode.commands.registerCommand("better-memo.switchToFileView", () => this.updateViewType("File")),
			vscode.commands.registerCommand("better-memo.switchToTagView", () => this.updateViewType("Tag")),
			vscode.commands.registerCommand("better-memo.navigateToMemo", (memo: MemoEntry) =>
				this.navigateToMemo(memo),
			),
			vscode.commands.registerCommand("better-memo.navigateToFile", (file: FileItem) => file.navigate()),
			vscode.commands.registerCommand("better-memo.completeMemo", (memo: MemoItem) => memo.complete(this)),
			vscode.commands.registerCommand("better-memo.confirmCompleteMemo", (memo: MemoItem) => memo.complete(this)),
			vscode.commands.registerCommand("better-memo.completeMemoNoConfirm", (memo: MemoItem) =>
				memo.complete(this, true),
			),
		);

		vscode.commands.executeCommand("setContext", "better-memo.explorerInitFinished", true);
	}

	dispose(): void {
		this.janitor.clearAll();
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
				if (configMaid.get("view.expandSecondaryByDefault")) {
					const reveals = [];
					for (const item of this.viewProvider.items) {
						for (const child of item.children)
							reveals.push(this.view.reveal(child, { select: false, expand: true }));
					}
					await Promise.allSettled(reveals);
				}
				for (const item of this.viewProvider.items) {
					if (configMaid.get("view.expandPrimaryByDefault")) {
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

class ExplorerViewProvider implements vscode.TreeDataProvider<ExplorerTreeItem> {
	items: InnerItemType[] = [];
	memoCount = 0;
	currentView: "File" | "Tag";

	private _onDidChangeTreeData: vscode.EventEmitter<void | ExplorerTreeItem> =
		new vscode.EventEmitter<void | ExplorerTreeItem>();
	readonly onDidChangeTreeData: vscode.Event<void | ExplorerTreeItem> = this._onDidChangeTreeData.event;

	constructor(private _memoFetcher: MemoFetcher) {}

	async init(): Promise<void> {
		await eventEmitter.wait("fetcherInitFinished").then(() => this.reloadItems());
	}

	getChildItems(): InnerItemType[] {
		return this.items;
	}

	setChildItems(items: InnerItemType[]): void {
		this.items = items;
	}

	getTreeItem(element: ExplorerTreeItem): ExplorerTreeItem {
		return element;
	}

	getParent(element: ExplorerTreeItem): CompletableInnerItem {
		return element.parent;
	}

	getChildren(element: InnerItemType | undefined): ExplorerTreeItem[] {
		if (element) return element.children;
		return this.items;
	}

	reloadItems(): void {
		this.items = this.getItems();
		this._onDidChangeTreeData.fire();
	}

	refresh(item?: ExplorerTreeItem): void {
		this._onDidChangeTreeData.fire(item);
	}

	private getItems(): InnerItemType[] {
		const isFileView = this.currentView === "File";
		const expandPrimaryGroup = configMaid.get("view.expandPrimaryByDefault");
		const expandSecondaryGroup = configMaid.get("view.expandSecondaryByDefault");

		const memos = this._memoFetcher.getMemos();
		const tags = this._memoFetcher.getTags();
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
			innerItem.children = halfLeafItems;

			let childMemoCount = 0;
			for (let j = 0; j < innerItem.children.length; j++) {
				const halfLeafItem = innerItem.children[j];
				const halfLeafLabel = halfLeafLabels[j];
				if (isFileView) halfLeafItem.iconPath = new vscode.ThemeIcon("bookmark", tags[halfLeafLabel]);

				let memos = halfLeaves[halfLeafLabel].sort((a, b) => a._offset - b._offset);
				const urgent = [];
				const normal = [];
				for (const memo of memos) {
					if (memo.priority !== 0) {
						urgent.push(memo);
						continue;
					}
					normal.push(memo);
				}
				memos = urgent.sort((a, b) => b.priority - a.priority).concat(normal);
				const tagColor = (<vscode.ThemeIcon>(isFileView ? halfLeafItem : innerItem).iconPath).color;
				const maxPriority = Math.max(...memos.map((memo) => (<MemoEntry>memo).priority));
				const memoItems = memos.map(
					(memo) => new MemoItem(<MemoEntry>memo, <InnerItemType>halfLeafItem, tagColor, maxPriority),
				);
				(<InnerItemType>halfLeafItem).children = memoItems;
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

class CompletableItem extends vscode.TreeItem {
	static confirmingItem: {
		item?: CompletableItem;
		label?: string | vscode.TreeItemLabel;
		desc?: string | boolean;
		icon?: string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } | vscode.ThemeIcon;
		context?: string;

		attemptedToComplete: boolean;
		confirmInterval?: NodeJS.Timeout;
		confirmTimeout?: NodeJS.Timeout;
	} = { attemptedToComplete: false };

	readonly hierarchy: "parent" | "child";

	constructor(label: string, expand: boolean | "none", public parent?: CompletableInnerItem) {
		let collapsibleState;
		if (expand === "none") {
			collapsibleState = vscode.TreeItemCollapsibleState.None;
		} else {
			collapsibleState = expand
				? vscode.TreeItemCollapsibleState.Expanded
				: vscode.TreeItemCollapsibleState.Collapsed;
		}
		super(label, collapsibleState);
		this.hierarchy = parent ? "parent" : "child";
	}

	confirmHandle(
		explorerTreeView: ExplorerTreeView,
		labelOptions: { words?: number; maxLength: number },
		confirmContext: string,
		noConfirm?: boolean,
	): boolean {
		const confirmingItem = CompletableItem.confirmingItem;
		const item = confirmingItem?.item ?? this;

		const reset = () => {
			confirmingItem.attemptedToComplete = false;
			clearInterval(confirmingItem.confirmInterval);
			clearTimeout(confirmingItem.confirmTimeout);

			[item.label, item.description, item.iconPath, item.contextValue] = [
				confirmingItem?.label ?? this.label,
				confirmingItem?.desc ?? this.description,
				confirmingItem?.icon ?? this.iconPath,
				confirmingItem?.context ?? this.contextValue,
			];
			explorerTreeView.viewProvider.refresh(item);
			explorerTreeView.memoFetcher.unsuppressForceScan();
		};

		if (!noConfirm && configMaid.get("view.confirmCompleteMemo")) {
			if (this !== item) {
				reset();
				confirmingItem.item = this;
				[confirmingItem.label, confirmingItem.desc, confirmingItem.icon, confirmingItem.context] = [
					this.label,
					this.description,
					this.iconPath,
					this.contextValue,
				];
			}
			explorerTreeView.memoFetcher.unsuppressForceScan();

			if (confirmingItem.attemptedToComplete) return true;
			confirmingItem.attemptedToComplete = true;

			let abbrevLabel = `${this.label
				.toString()
				.split(/\s/, labelOptions.words ?? 1)
				.join(" ")}`;
			if (abbrevLabel.length > labelOptions.maxLength)
				abbrevLabel = `${abbrevLabel.slice(0, labelOptions.maxLength)}...`;
			this.label = abbrevLabel;
			this.contextValue = confirmContext;

			explorerTreeView.memoFetcher.suppressForceScan();
			const timeout = configMaid.get("view.confirmCompleteTimeout");
			let time = timeout;
			const updateTime = (time: number) => {
				this.description = `Confirm in ${Math.round(time / 1000)}`;
				const gbVal = (255 * time) / timeout;
				this.iconPath = new vscode.ThemeIcon("loading~spin", colorMaid.interpolate([255, gbVal, gbVal]));
				explorerTreeView.viewProvider.refresh(this);
			};
			updateTime(timeout);
			confirmingItem.confirmInterval = setInterval(
				() => updateTime((time -= 1000)),
				timeout / Math.round(time / 1000),
			);

			confirmingItem.confirmTimeout = setTimeout(() => reset(), timeout);
			return false;
		}
		return true;
	}
}

class CompletableInnerItem extends CompletableItem {
	children: ExplorerTreeItem[] = [];

	constructor(label: string, expand: boolean, parent?: CompletableInnerItem) {
		super(label, expand, parent);
	}

	getChildItems(): ExplorerTreeItem[] {
		return this.children;
	}

	setChildItems(items: ExplorerTreeItem[]): void {
		this.children = items;
	}
}

class FileItem extends CompletableInnerItem {
	constructor(readonly path: string, expand: boolean, parent?: CompletableInnerItem) {
		super(vscode.workspace.asRelativePath(path), expand, parent);
		this.resourceUri = vscode.Uri.file(path);
		this.iconPath = vscode.ThemeIcon.File;
		this.contextValue = "file";
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

	// complete(viewProvider: ExplorerViewProvider, noConfirm?: boolean) {
	// 	if (
	// 		!this.confirmHandle(
	// 			viewProvider,
	// 			{ maxLength: 15 },
	// 			this.confirmCompleteIcon,
	// 			"fileWaitingForConfirmComplete",
	// 			noConfirm,
	// 		)
	// 	)
	// 		return;
	// const memos = this.hierarchy === "parent" ? this.children.map((c) => (<Tag>c).children).flat() : this.children;
	// const memo = this.memoEntry;
	// await vscode.workspace.openTextDocument(memo.path).then((doc) => {
	// 	const removeLine =
	// 		memo.line < doc.lineCount - 1 &&
	// 		doc
	// 			.lineAt(memo.line)
	// 			.text.replace(new RegExp(`${reEscape(memo.raw)}|${reEscape(getFormattedMemo(memo))}`), "")
	// 			.trim().length === 0;
	// 	const start = doc.positionAt(memo.offset);
	// 	const end = removeLine ? new vscode.Position(memo.line + 1, 0) : start.translate(0, memo.rawLength);
	// 	const range = new vscode.Range(start, end);
	// 	const edit = new FE.FileEdit();
	// 	edit.delete(doc.uri, range);
	// 	edit.apply({ isRefactoring: true }, false, configMaid.get("view.alwaysOpenFileOnCompleteSingleMemo")).then(() => {
	// 		const editor = vscode.window.activeTextEditor;
	// 		if (editor?.document === doc) {
	// 			editor.revealRange(new vscode.Range(start, start));
	// 			editor.selection = new vscode.Selection(start, start);
	// 		}
	// 	});
	// 	deleteItem(this, viewProvider);
	// });
	// viewProvider.refresh();
	// }
}

class TagItem extends CompletableInnerItem {
	constructor(tag: string, expand: boolean, parent?: CompletableInnerItem) {
		super(tag, expand, parent);

		this.contextValue = "tag";
	}
}

class MemoItem extends CompletableItem {
	constructor(
		public memoEntry: MemoEntry,
		parent: CompletableInnerItem,
		tagColor: vscode.ThemeColor,
		maxPriority: number,
	) {
		const content = memoEntry.content === "" ? "Placeholder T^T" : memoEntry.content;
		super(content, "none", parent);

		this.description = `Ln ${memoEntry.line + 1}`;
		this.tooltip = new vscode.MarkdownString(
			`#### **${memoEntry.tag}** ~ *${memoEntry.relativePath}* - Ln ${memoEntry.line + 1}\n***\n## ${content}`,
		);
		this.tooltip.supportHtml = true;
		this.contextValue = "memo";
		this.command = {
			command: "better-memo.navigateToMemo",
			title: "Navigate to Memo",
			tooltip: "Navigate to Memo",
			arguments: [memoEntry],
		};
		this.iconPath =
			memoEntry.priority === 0
				? new vscode.ThemeIcon("circle-filled", tagColor)
				: new vscode.ThemeIcon(
						"circle-outline",
						colorMaid.interpolate([255, (1 - memoEntry.priority / maxPriority) * 255, 0]),
				  );
	}

	complete(explorerTreeView: ExplorerTreeView, noConfirm?: boolean): void {
		if (
			!this.confirmHandle(
				explorerTreeView,
				{ words: 3, maxLength: 12 },
				"memoWaitingForConfirmComplete",
				noConfirm,
			)
		)
			return;
		const memo = this.memoEntry;
		vscode.workspace.openTextDocument(memo.path).then((doc) => {
			const removeLine =
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
			edit.apply({ isRefactoring: true }, false, configMaid.get("view.alwaysOpenFileOnCompleteSingleMemo")).then(
				() => {
					vscode.window.showInformationMessage(`finished\${}`);
					const editor = vscode.window.activeTextEditor;
					if (editor?.document === doc) {
						editor.revealRange(new vscode.Range(start, start));
						editor.selection = new vscode.Selection(start, start);
					}
				},
			);
			explorerTreeView.viewProvider.refresh(deleteItem(this, explorerTreeView.viewProvider));
		});
	}
}

function deleteItem(item: ExplorerTreeItem, viewProvider: ExplorerViewProvider): CompletableInnerItem {
	const parent = item.parent ?? viewProvider;
	//@ts-ignore
	parent.setChildItems(parent.getChildItems().filter((_item) => _item !== item));
	if (item.parent && parent.getChildItems().length === 0) deleteItem(<ExplorerTreeItem>parent, viewProvider);
	return item.parent;
}
