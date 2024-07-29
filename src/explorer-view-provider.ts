import * as vscode from "vscode";
import { EE } from "./utils/event-emitter";
import { FE } from "./utils/file-edit";
import { getConfigMaid } from "./utils/config-maid";
import { Janitor } from "./utils/janitor";
import { MemoFetcher, MemoEntry, getFormattedMemo } from "./memo-fetcher";

const eventEmitter = EE.getEventEmitter();
const configMaid = getConfigMaid();
export class ExplorerTreeView {
	private viewProvider: ExplorerViewProvider;
	private view: vscode.TreeView<TreeItem>;
	private janitor = new Janitor();

	init(memoFetcher: MemoFetcher) {
		console.time("a");
		this.viewProvider = new ExplorerViewProvider(memoFetcher);
		this.view = vscode.window.createTreeView("better-memo.memoExplorer", {
			treeDataProvider: this.viewProvider,
			showCollapseAll: true,
		});
		this.janitor.add(
			this.view,

			configMaid.onChange("view", () => this.viewProvider.refresh()),
			configMaid.onChange(["view.expandPrimaryGroupByDefault", "view.expandSecondaryGroupByDefault"], () =>
				eventEmitter.emit("updateItemCollapsibleState"),
			),

			eventEmitter.subscribe("updateView", () => this.viewProvider.reloadMemos()),
			eventEmitter.subscribe("updateItemCollapsibleState", () => this.updateItemCollapsibleState()),

			vscode.commands.registerCommand("better-memo.navigateToMemo", (memo) => this.navigateToMemo(memo)),
			vscode.commands.registerCommand("better-memo.navigateToFile", (file: File) => file?.navigate()),
			vscode.commands.registerCommand("better-memo.explorerExpandAll", () => {
				for (const item of this.viewProvider.items) this.view.reveal(item, { select: false, expand: 2 });
			}),
			vscode.commands.registerCommand("better-memo.completeMemo", (memo: Memo) =>
				memo?.complete(this.viewProvider).then(
					() => {
						console.timeLog("a", "refresh");
						this.viewProvider.refresh();
					},
					() => null,
				),
			),
		);
		vscode.commands.executeCommand("setContext", "better-memo.explorerInitFinished", true);
	}
	dispose() {
		this.janitor.clearAll();
	}

	private navigateToMemo(memo: MemoEntry) {
		vscode.workspace.openTextDocument(memo.path).then((doc) => {
			vscode.window.showTextDocument(doc).then((editor) => {
				let pos = doc.positionAt(memo.offset + memo.rawLength);
				if (pos.line === memo.line - 1) pos = pos.translate(-1, doc.lineAt(pos.line - 1).text.length);
				editor.selection = new vscode.Selection(pos, pos);
				editor.revealRange(new vscode.Range(pos, pos));
			});
		});
	}
	private updateItemCollapsibleState() {
		this.view.reveal(this.viewProvider.items[0], { select: false, focus: true }).then(() => {
			Promise.resolve(vscode.commands.executeCommand("list.collapseAll")).finally(async () => {
				if (configMaid.get("view.expandSecondaryGroupByDefault")) {
					const reveals = [];
					for (const item of this.viewProvider.items)
						for (const child of item.children) reveals.push(this.view.reveal(child, { select: false, expand: true }));
					await Promise.allSettled(reveals);
				}
				for (const item of this.viewProvider.items) {
					if (configMaid.get("view.expandPrimaryGroupByDefault")) {
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
class ExplorerViewProvider implements vscode.TreeDataProvider<TreeItem> {
	items: ParentItem[] = [];
	memoCount = 0;
	private _onDidChangeTreeData: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData: vscode.Event<void> = this._onDidChangeTreeData.event;

	constructor(private _memoFetcher: MemoFetcher) {
		configMaid.listen("view.primaryGroup");
		configMaid.listen("view.expandPrimaryGroupByDefault");
		configMaid.listen("view.expandSecondaryGroupByDefault");
		eventEmitter.wait("fetcherInit").then(() => this.reloadMemos());
	}
	getChildItems() {
		return this.items;
	}
	setChildItems(items: ParentItem[]) {
		this.items = items;
	}
	getTreeItem(element: TreeItem) {
		return element;
	}
	getParent(element: TreeItem) {
		return element.parent;
	}
	getChildren(element: ParentItem | undefined) {
		if (element) return element.children;
		return this.items;
	}
	reloadMemos() {
		this.items = this.getItems();
		this._onDidChangeTreeData.fire();
	}
	refresh() {
		this._onDidChangeTreeData.fire();
		console.log("items:", this.items);
	}

	private getItems() {
		const fileIsPrimary = configMaid.get("view.primaryGroup") === "File";
		const expandPrimaryGroup = configMaid.get("view.expandPrimaryGroupByDefault");
		const expandSecondaryGroup = configMaid.get("view.expandSecondaryGroupByDefault");

		const memos = this._memoFetcher.getMemos();
		this.memoCount = memos.length;
		const mainGroup = groupObjects(memos, fileIsPrimary ? "relativePath" : "tag");
		const pLabels = Object.keys(mainGroup).sort();
		const items = pLabels.map((label) => new (fileIsPrimary ? File : Tag)(label, expandPrimaryGroup));

		for (let i = 0; i < pLabels.length; i++) {
			const subGroup = groupObjects(mainGroup[pLabels[i]], fileIsPrimary ? "tag" : "relativePath");
			const cLabels = Object.keys(subGroup).sort();

			const parentItem = items[i];
			const childItems = cLabels.map(
				(label) => new (fileIsPrimary ? Tag : File)(label, expandSecondaryGroup, parentItem),
			);
			parentItem.children = childItems;

			let childMemoCount = 0;
			for (let j = 0; j < parentItem.children.length; j++) {
				const memos = subGroup[cLabels[j]].sort((a, b) => a._offset - b._offset);
				const childItem = parentItem.children[j];
				const memoItems = memos.map((m) => new Memo(<MemoEntry>m, <ParentItem>childItem));
				// @ts-ignore
				childItem.children = memoItems;
				childMemoCount += memoItems.length;

				childItem.description = `${memoItems.length} Memo${multiplicity(memoItems)}`;
				childItem.tooltip = `${fileIsPrimary ? "Tag" : "File"}: ${childItem.label} - ${memoItems.length}M`;
			}

			parentItem.description = `${childItems.length} ${fileIsPrimary ? "Tag" : "File"}${multiplicity(
				childItems,
			)} > ${childMemoCount} Memo${multiplicity(childMemoCount)}`;
			parentItem.tooltip = `${fileIsPrimary ? "File" : "Tag"}: ${parentItem.label} - ${
				childItems.length
			}C${childMemoCount}M`;
		}
		return items;
	}
}

type TreeItem = ParentItem | Memo;
class ParentItem extends vscode.TreeItem {
	children: TreeItem[] = [];
	hierarchy: "parent" | "child";
	constructor(label: string, expand: boolean, public parent?: ParentItem) {
		super(label, expand ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
		this.hierarchy = parent ? "child" : "parent";
	}
	getChildItems() {
		return this.children;
	}
	setChildItems(items: TreeItem[]) {
		this.children = items;
	}
	complete() {}
}
class File extends ParentItem {
	constructor(label: string, expand: boolean, parent?: ParentItem) {
		super(label, expand, parent);
		this.contextValue = "file";
	}

	navigate() {
		//@ts-ignore
		if (this.children.length === 0 || this.children[0].children.length === 0) return;
		//@ts-ignore
		const firstMemo = this.hierarchy === "parent" ? this.children[0].children[0] : this.children[0];
		vscode.commands.executeCommand("better-memo.navigateToMemo", firstMemo);
	}
}
class Tag extends ParentItem {
	constructor(label: string, expand: boolean, parent?: ParentItem) {
		super(label, expand, parent);
		this.contextValue = "tag";
	}
}
class Memo extends vscode.TreeItem {
	constructor(public memoEntry: MemoEntry, public parent: ParentItem) {
		const content = memoEntry.content === "" ? "Placeholder T^T" : memoEntry.content;
		super(content, vscode.TreeItemCollapsibleState.None);
		this.description = `Ln ${memoEntry.line + 1}`;
		this.tooltip = `${memoEntry.tag} ~ ${memoEntry.relativePath} - Ln ${memoEntry.line + 1}\n${content}`;
		this.contextValue = "memo";
		this.command = {
			command: "better-memo.navigateToMemo",
			title: "Better Memo: Navigate To Memo",
			arguments: [memoEntry],
		};
	}

	async complete(viewProvider: ExplorerViewProvider) {
		const memo = this.memoEntry;
		await vscode.workspace.openTextDocument(memo.path).then((doc) => {
			const removeLine =
				memo.line < doc.lineCount - 1 &&
				doc
					.lineAt(memo.line)
					.text.replace(new RegExp(`${memo.raw}|${getFormattedMemo(memo)}`), "")
					.trim().length === 0;
			const start = doc.positionAt(memo.offset);
			const end = removeLine ? new vscode.Position(memo.line + 1, 0) : start.translate(0, memo.rawLength);
			const range = new vscode.Range(start, end);
			const edit = new FE.FileEdit();
			edit.delete(doc.uri, range);
			edit.apply({ isRefactoring: true });
			deleteItem(this, viewProvider);
			console.timeLog("a", "deleteditems");
		});
	}
}

function groupObjects(arrayOrIterable: { [key: string]: any }[], grouper: string) {
	const groups: { [group: string]: { [key: string]: any }[] } = {};
	for (const object of arrayOrIterable) {
		if (!groups[object[grouper]]) groups[object[grouper]] = [];

		groups[object[grouper]].push(object);
	}
	return groups;
}

//@ts-ignore
const multiplicity = (countable: number | any[]) => ((countable.length ?? countable) === 1 ? "" : "s");

function deleteItem(item: TreeItem, viewProvider: ExplorerViewProvider) {
	const parent = item.parent ?? viewProvider;
	//@ts-ignore
	parent.setChildItems(parent.getChildItems().filter((_item) => _item !== item));
	if (!item.parent) return;
	//@ts-ignore
	if (parent.getChildItems().length === 0) deleteItem(parent, viewProvider);
}
