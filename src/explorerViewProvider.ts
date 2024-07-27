import * as vscode from "vscode";
import Janitor from "./utils/Janitor";
import ConfigMaid from "./utils/ConfigMaid";
import { EventEmitter } from "./utils/EventEmitter";
import { MemoFetcher, MemoEntry } from "./memoFetcher";

export default class ExplorerTreeView {
	private _view?: vscode.TreeView<TreeItem>;
	private _janitor = new Janitor();

	init(memoFetcher: MemoFetcher) {
		const viewProvider = new ExplorerViewProvider(memoFetcher);
		this._view = vscode.window.createTreeView("better-memo.memoExplorer", {
			treeDataProvider: viewProvider,
			showCollapseAll: true,
		});
		this._janitor.add(
			this._view,
			EventEmitter.subscribe("updateView", () => viewProvider.refresh()),
			ConfigMaid.onChange("view", () => viewProvider.refresh()),
			ConfigMaid.onChange(
				["view.expandPrimaryGroupByDefault", "view.expandSecondaryGroupByDefault"],
				() => EventEmitter.emit("updateItemCollapsibleState"),
			),
			EventEmitter.subscribe("updateItemCollapsibleState", () => {
				const update = async () => {
					for (const parent of viewProvider.items) {
						const revealChildren = [];
						for (const child of parent.children) {
							if (ConfigMaid.get("view.expandSecondaryGroupByDefault")) {
								revealChildren.push(
									this._view.reveal(child, {
										select: false,
										expand: true,
									}),
								);
							}
						}
						await Promise.allSettled(revealChildren);
						if (ConfigMaid.get("view.expandPrimaryGroupByDefault")) {
							this._view.reveal(parent, {
								select: false,
								expand: true,
							});
						} else {
							await this._view.reveal(parent, { select: false, focus: true });
							vscode.commands.executeCommand("list.collapse");
						}
					}
					this._view.reveal(viewProvider.items[0], { select: false, focus: true });
				};
				this._view.reveal(viewProvider.items[0], { select: false, focus: true }).then(() => {
					vscode.commands.executeCommand("list.collapseAll").then(update, update);
				});
			}),

			vscode.commands.registerCommand("better-memo.navigateToMemo", (memo: MemoEntry) => {
				vscode.workspace.openTextDocument(memo.path).then((doc) => {
					vscode.window.showTextDocument(doc).then((editor) => {
						let pos = doc.positionAt(memo.offset + memo.rawLength);
						if (pos.line === memo.line)
							pos = pos.translate(-1, doc.lineAt(pos.line - 1).text.length);
						editor.selection = new vscode.Selection(pos, pos);
						editor.revealRange(new vscode.Range(pos, pos));
					});
				});
			}),
			vscode.commands.registerCommand("better-memo.explorerExpandAll", () => {
				for (const item of viewProvider.items)
					this._view.reveal(item, { select: false, expand: 2 });
			}),
		);
		vscode.commands.executeCommand("setContext", "better-memo.explorerInitFinished", true);
	}
	dispose() {
		this._janitor.clearAll();
	}
}
class ExplorerViewProvider implements vscode.TreeDataProvider<TreeItem> {
	items: (File | Tag)[] = [];
	memoCount = 0;

	private _onDidChangeTreeData: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData: vscode.Event<void> = this._onDidChangeTreeData.event;

	constructor(private _memoFetcher: MemoFetcher) {
		ConfigMaid.listen("view.primaryGroup");
		ConfigMaid.listen("view.expandPrimaryGroupByDefault");
		ConfigMaid.listen("view.expandSecondaryGroupByDefault");
		EventEmitter.wait("fetcherInit").then(() => this.refresh());
	}
	getTreeItem(element: TreeItem) {
		return element;
	}
	getParent(element: TreeItem) {
		return element.parent;
	}
	getChildren(element: File | Tag | undefined) {
		if (element) return element.children;
		return this.items;
	}
	refresh() {
		this.items = this._getItems();
		this._onDidChangeTreeData.fire();
	}

	private _getItems() {
		const fileIsPrimary = ConfigMaid.get("view.primaryGroup") === "File";
		const expandPrimaryGroup = ConfigMaid.get("view.expandPrimaryGroupByDefault");
		const expandSecondaryGroup = ConfigMaid.get("view.expandSecondaryGroupByDefault");

		const memos = this._memoFetcher.getMemos();
		this.memoCount = memos.length;
		const mainGroup = ObjectGroupBy(memos, fileIsPrimary ? "relativePath" : "tag");
		const p_labels = Object.keys(mainGroup).sort();
		const items = p_labels.map((l) =>
			fileIsPrimary ? new File(l, expandPrimaryGroup) : new Tag(l, expandPrimaryGroup),
		);

		for (let i = 0; i < p_labels.length; i++) {
			const subGroup = ObjectGroupBy(mainGroup[p_labels[i]], fileIsPrimary ? "tag" : "relativePath");
			const c_labels = Object.keys(subGroup).sort();

			const parentItem = items[i];
			const childItems = c_labels.map((l) =>
				fileIsPrimary
					? new Tag(l, expandSecondaryGroup, parentItem)
					: new File(l, expandSecondaryGroup, parentItem),
			);
			parentItem.children = childItems;

			let childMemoCount = 0;
			for (let j = 0; j < parentItem.children.length; j++) {
				const memos = subGroup[c_labels[j]].sort((a, b) => a._offset - b._offset);
				const childItem = parentItem.children[j];
				const memoItems = memos.map((m) => new Memo(<MemoEntry>m, <File | Tag>childItem));
				// @ts-ignore
				childItem.children = memoItems;
				childMemoCount += memoItems.length;

				childItem.description = `${memoItems.length} Memo${multiplicity(memoItems)}`;
				childItem.tooltip = `${fileIsPrimary ? "Tag" : "File"}: ${childItem.label} - ${
					memoItems.length
				}M`;
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

type TreeItem = File | Tag | Memo;
class ParentItem extends vscode.TreeItem {
	children: TreeItem[] = [];
	constructor(label: string, expand: boolean, public parent?: ParentItem) {
		super(
			label,
			expand ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
		);
	}
}
class File extends ParentItem {}
class Tag extends ParentItem {}
class Memo extends vscode.TreeItem {
	constructor(public memoEntry: MemoEntry, public parent: ParentItem) {
		const content = memoEntry.content === "" ? "Placeholder T^T" : memoEntry.content;
		super(content, vscode.TreeItemCollapsibleState.None);
		this.description = `Ln ${memoEntry.line}`;
		this.tooltip = `${memoEntry.tag} ~ ${memoEntry.relativePath} - Ln ${memoEntry.line}\n${content}`;
		this.command = {
			command: "better-memo.navigateToMemo",
			title: "Better Memo: Navigate To Memo",
			arguments: [memoEntry],
		};
	}
}

function ObjectGroupBy(arrayOrIterable: { [key: string]: any }[], grouper: string) {
	const groups: { [group: string]: { [key: string]: any }[] } = {};
	for (const object of arrayOrIterable) {
		if (!groups[object[grouper]]) groups[object[grouper]] = [];

		groups[object[grouper]].push(object);
	}
	return groups;
}
//@ts-ignore
const multiplicity = (countable: number | any[]) => ((countable.length ?? countable) === 1 ? "" : "s");
