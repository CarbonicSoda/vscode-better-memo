import * as vscode from "vscode";
import { EE } from "./utils/event-emitter";
import { Janitor } from "./utils/janitor";
import { getConfigMaid } from "./utils/config-maid";
import { MemoFetcher, MemoEntry } from "./memo-fetcher";

const eventEmitter = EE.getEventEmitter();
const configMaid = getConfigMaid();
export class ExplorerTreeView {
	private viewProvider: ExplorerViewProvider;
	private view: vscode.TreeView<TreeItem>;
	private janitor = new Janitor();

	init(memoFetcher: MemoFetcher) {
		this.viewProvider = new ExplorerViewProvider(memoFetcher);
		this.view = vscode.window.createTreeView("better-memo.memoExplorer", {
			treeDataProvider: this.viewProvider,
			showCollapseAll: true,
		});
		this.janitor.add(
			this.view,
			eventEmitter.subscribe("updateView", () => this.viewProvider.refresh()),
			configMaid.onChange("view", () => this.viewProvider.refresh()),
			configMaid.onChange(["view.expandPrimaryGroupByDefault", "view.expandSecondaryGroupByDefault"], () =>
				eventEmitter.emit("updateItemCollapsibleState"),
			),
			eventEmitter.subscribe("updateItemCollapsibleState", () => this.updateItemCollapsibleState()),

			vscode.commands.registerCommand("better-memo.navigateToMemo", (memo: MemoEntry) => {
				vscode.workspace.openTextDocument(memo.path).then((doc) => {
					vscode.window.showTextDocument(doc).then((editor) => {
						let pos = doc.positionAt(memo.offset + memo.rawLength);
						if (pos.line === memo.line) pos = pos.translate(-1, doc.lineAt(pos.line - 1).text.length);
						editor.selection = new vscode.Selection(pos, pos);
						editor.revealRange(new vscode.Range(pos, pos));
					});
				});
			}),
			vscode.commands.registerCommand("better-memo.explorerExpandAll", () => {
				for (const item of this.viewProvider.items) this.view.reveal(item, { select: false, expand: 2 });
			}),
		);
		vscode.commands.executeCommand("setContext", "better-memo.explorerInitFinished", true);
	}
	dispose() {
		this.janitor.clearAll();
	}

	private updateItemCollapsibleState() {
		this.view.reveal(this.viewProvider.items[0], { select: false, focus: true }).then(() => {
			Promise.resolve(vscode.commands.executeCommand("list.collapseAll")).finally(async () => {
				if (configMaid.get("view.expandSecondaryGroupByDefault")) {
					const reveals = [];
					for (const item of this.viewProvider.items) {
						for (const child of item.children)
							reveals.push(this.view.reveal(child, { select: false, expand: true }));
					}
					await Promise.allSettled(reveals);
				}
				for (const item of this.viewProvider.items) {
					if (configMaid.get("view.expandPrimaryGroupByDefault")) {
						this.view.reveal(item, { select: false, expand: true });
					} else {
						await this.view.reveal(item, { select: false, focus: true });
						vscode.commands.executeCommand("list.collapse");
					}
				}
				this.view.reveal(this.viewProvider.items[0], { select: false, focus: true });
			});
		});
	}
}
class ExplorerViewProvider implements vscode.TreeDataProvider<TreeItem> {
	items: (File | Tag)[] = [];
	memoCount = 0;

	private _onDidChangeTreeData: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData: vscode.Event<void> = this._onDidChangeTreeData.event;

	constructor(private _memoFetcher: MemoFetcher) {
		configMaid.listen("view.primaryGroup");
		configMaid.listen("view.expandPrimaryGroupByDefault");
		configMaid.listen("view.expandSecondaryGroupByDefault");
		eventEmitter.wait("fetcherInit").then(() => this.refresh());
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
		this.items = this.getItems();
		this._onDidChangeTreeData.fire();
	}

	private getItems() {
		const fileIsPrimary = configMaid.get("view.primaryGroup") === "File";
		const expandPrimaryGroup = configMaid.get("view.expandPrimaryGroupByDefault");
		const expandSecondaryGroup = configMaid.get("view.expandSecondaryGroupByDefault");

		const memos = this._memoFetcher.getMemos();
		this.memoCount = memos.length;
		const mainGroup = groupObjects(memos, fileIsPrimary ? "relativePath" : "tag");
		const pLabels = Object.keys(mainGroup).sort();
		const items = pLabels.map((l) =>
			fileIsPrimary ? new File(l, expandPrimaryGroup) : new Tag(l, expandPrimaryGroup),
		);

		for (let i = 0; i < pLabels.length; i++) {
			const subGroup = groupObjects(mainGroup[pLabels[i]], fileIsPrimary ? "tag" : "relativePath");
			const cLabels = Object.keys(subGroup).sort();

			const parentItem = items[i];
			const childItems = cLabels.map((l) =>
				fileIsPrimary
					? new Tag(l, expandSecondaryGroup, parentItem)
					: new File(l, expandSecondaryGroup, parentItem),
			);
			parentItem.children = childItems;

			let childMemoCount = 0;
			for (let j = 0; j < parentItem.children.length; j++) {
				const memos = subGroup[cLabels[j]].sort((a, b) => a._offset - b._offset);
				const childItem = parentItem.children[j];
				const memoItems = memos.map((m) => new Memo(<MemoEntry>m, <File | Tag>childItem));
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

type TreeItem = File | Tag | Memo;
class ParentItem extends vscode.TreeItem {
	children: TreeItem[] = [];
	constructor(label: string, expand: boolean, public parent?: ParentItem) {
		super(label, expand ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
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
