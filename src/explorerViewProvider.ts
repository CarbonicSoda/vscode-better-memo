import * as vscode from "vscode";
import Janitor from "./utils/Janitor";
import ConfigMaid from "./utils/ConfigMaid";
import { EventEmitter } from "./utils/EventEmitter";
import { MemoFetcher, MemoEntry } from "./memoFetcher";

export default class ExplorerViewProvider implements vscode.TreeDataProvider<TreeItem> {
	private _items: (File | Tag)[] = [];
	private _janitor = new Janitor();

	private _onDidChangeTreeData: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData: vscode.Event<void> = this._onDidChangeTreeData.event;

	constructor(private _memoFetcher: MemoFetcher) {
		ConfigMaid.listen("view.primaryGroup");
		ConfigMaid.listen("view.expandPrimaryGroupByDefault");
		ConfigMaid.listen("view.expandSecondaryGroupByDefault");

		EventEmitter.wait("fetcherInit").then(() => {
			this._janitor.add(
				EventEmitter.subscribe("updateView", () => this.refresh()),
				ConfigMaid.onChange("view", () => this.refresh()),

				vscode.commands.registerCommand("better-memo.navigateToMemo", (memo: MemoEntry) => {
					vscode.workspace.openTextDocument(memo.path).then((doc) => {
						vscode.window.showTextDocument(doc).then((editor) => {
							let pos = doc.positionAt(memo.offset + memo.rawLength);
							if (pos.line === memo.line) {
								pos = pos.translate(
									-1,
									doc.lineAt(pos.line - 1).text.length,
								);
							}
							editor.selection = new vscode.Selection(pos, pos);
							editor.revealRange(new vscode.Range(pos, pos));
						});
					});
				}),
			);
			this.refresh();
		});
	}
	public getTreeItem(element: TreeItem) {
		return element;
	}
	public getChildren(element: File | Tag | undefined) {
		if (element) return element.children;
		return this._items;
	}
	public refresh() {
		this._items = this._getItems();
		vscode.commands.executeCommand("setContext", "better-memo.hasMemos", this._items.length !== 0);
		this._onDidChangeTreeData.fire();
	}
	public dispose() {
		this._janitor.clearAll();
	}

	private _getItems() {
		const fileIsPrimary = ConfigMaid.get("view.primaryGroup") === "File";
		const expandPrimaryGroup = ConfigMaid.get("view.expandPrimaryGroupByDefault");
		const expandSecondaryGroup = ConfigMaid.get("view.expandSecondaryGroupByDefault");

		const mainGroup = ObjectGroupBy(this._memoFetcher.getMemos(), fileIsPrimary ? "relativePath" : "tag");
		const p_labels = Object.keys(mainGroup).sort();
		const items = p_labels.map((l) =>
			fileIsPrimary ? new File(l, expandPrimaryGroup) : new Tag(l, expandPrimaryGroup),
		);

		for (let i = 0; i < p_labels.length; i++) {
			const subGroup = ObjectGroupBy(mainGroup[p_labels[i]], fileIsPrimary ? "tag" : "relativePath");
			const c_labels = Object.keys(subGroup).sort();

			const childItems = c_labels.map((l) =>
				fileIsPrimary ? new Tag(l, expandSecondaryGroup) : new File(l, expandSecondaryGroup),
			);
			const parentItem = items[i];
			parentItem.children = childItems;

			let childMemoCount = 0;
			for (let j = 0; j < parentItem.children.length; j++) {
				const memos = subGroup[c_labels[j]].sort((a, b) => a._offset - b._offset);
				const memoItems = memos.map((m) => new Memo(<MemoEntry>m));
				const childItem = parentItem.children[j];
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
	public children: TreeItem[] = [];
	constructor(label: string, expand: boolean) {
		super(
			label,
			expand ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
		);
	}
}
class File extends ParentItem {}
class Tag extends ParentItem {}
class Memo extends vscode.TreeItem {
	constructor(public memoEntry: MemoEntry) {
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
