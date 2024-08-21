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
	private view: vscode.TreeView<ExplorerTreeItem>;
	private janitor = new Janitor();

	init(memoFetcher: MemoFetcher) {
		configMaid.listen("view.defaultView");
		configMaid.listen("view.expandPrimaryByDefault");
		configMaid.listen("view.expandSecondaryByDefault");
		configMaid.listen("view.confirmCompleteMemo");
		configMaid.listen("view.confirmCompleteMultiple");
		configMaid.listen("view.confirmCompleteTimeout");
		configMaid.listen("view.alwaysOpenFileOnCompleteSingleMemo");

		this.viewProvider = new ExplorerViewProvider(memoFetcher);
		this.updateViewType(this.viewProvider.currentView);
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
			vscode.commands.registerCommand("better-memo.navigateToMemo", (memo: MemoEntry) => this.navigateToMemo(memo)),
			vscode.commands.registerCommand("better-memo.navigateToFile", (file: File) => file.navigate()),
			vscode.commands.registerCommand("better-memo.completeMemo", (memo: Memo) => memo.complete(this.viewProvider)),
			vscode.commands.registerCommand("better-memo.confirmCompleteMemo", (memo: Memo) => memo.complete(this.viewProvider)),
			vscode.commands.registerCommand("better-memo.completeMemoNoConfirm", (memo: Memo) => memo.complete(this.viewProvider, true)),
		);
		vscode.commands.executeCommand("setContext", "better-memo.explorerInitFinished", true);
	}
	dispose() {
		this.janitor.clearAll();
	}

	private updateViewType(view: "File" | "Tag") {
		this.viewProvider.currentView = view;
		vscode.commands.executeCommand(
			"setContext",
			`better-memo.explorerIs${view === "File" ? "Tag" : "File"}View`,
			false,
		);
		vscode.commands.executeCommand("setContext", `better-memo.explorerIs${view}View`, true);
		this.viewProvider.reloadItems();
	}
	private navigateToMemo(memo: MemoEntry) {
		vscode.workspace.openTextDocument(memo.path).then((doc) => {
			vscode.window.showTextDocument(doc).then((editor) => {
				let pos = doc.positionAt(memo.offset + memo.rawLength);
				editor.selection = new vscode.Selection(pos, pos);
				editor.revealRange(new vscode.Range(pos, pos));
			});
		});
	}
	private updateItemCollapsibleState() {
		this.view.reveal(this.viewProvider.items[0], { select: false, focus: true }).then(() => {
			Promise.resolve(vscode.commands.executeCommand("list.collapseAll")).finally(async () => {
				if (configMaid.get("view.expandSecondaryByDefault")) {
					const reveals = [];
					for (const item of this.viewProvider.items)
						for (const child of item.children) reveals.push(this.view.reveal(child, { select: false, expand: true }));
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
	items: ParentItemType[] = [];
	memoCount = 0;
	currentView: "File" | "Tag";
	private _onDidChangeTreeData: vscode.EventEmitter<void | ExplorerTreeItem> = new vscode.EventEmitter<void | ExplorerTreeItem>();
	readonly onDidChangeTreeData: vscode.Event<void | ExplorerTreeItem> = this._onDidChangeTreeData.event;

	constructor(private _memoFetcher: MemoFetcher) {
		this.currentView = configMaid.get("view.defaultView");
		eventEmitter.wait("fetcherInit").then(() => this.reloadItems());
	}
	getChildItems() {
		return this.items;
	}
	setChildItems(items: ParentItemType[]) {
		this.items = items;
	}
	getTreeItem(element: ExplorerTreeItem) {
		return element;
	}
	getParent(element: ExplorerTreeItem) {
		return element.parent;
	}
	getChildren(element: ParentItemType | undefined) {
		if (element) return element.children;
		return this.items;
	}
	reloadItems() {
		this.items = this.getItems();
		this._onDidChangeTreeData.fire();
	}
	refresh(item?: ExplorerTreeItem) {
		this._onDidChangeTreeData.fire(item);
	}

	private getItems() {
		const isFileView = this.currentView === "File";
		const expandPrimaryGroup = configMaid.get("view.expandPrimaryByDefault");
		const expandSecondaryGroup = configMaid.get("view.expandSecondaryByDefault");

		const memos = this._memoFetcher.getMemos();
		this.memoCount = memos.length;
		const mainGroup = groupObjects(memos, isFileView ? "path" : "tag");
		const pLabels = Object.keys(mainGroup).sort();
		const items = pLabels.map((label) => new (isFileView ? File : Tag)(label, expandPrimaryGroup));

		for (let i = 0; i < pLabels.length; i++) {
			const subGroup = groupObjects(mainGroup[pLabels[i]], isFileView ? "tag" : "path");
			const cLabels = Object.keys(subGroup).sort();

			const parentItem = items[i];
			const childItems = cLabels.map((label) => new (isFileView ? Tag : File)(label, expandSecondaryGroup, parentItem));
			parentItem.children = childItems;

			let childMemoCount = 0;
			for (let j = 0; j < parentItem.children.length; j++) {
				let memos = subGroup[cLabels[j]].sort((a, b) => a._offset - b._offset);
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
				const childItem = parentItem.children[j];
				const memoItems = memos.map((m) => new Memo(<MemoEntry>m, <ParentItemType>childItem));
				(<ParentItemType>childItem).children = memoItems;
				childMemoCount += memoItems.length;

				childItem.description = `${memoItems.length} Memo${multiplicity(memoItems)}`;
				childItem.tooltip = `${isFileView ? "Tag" : "File"}: ${childItem.label} - ${memoItems.length}M`;
			}

			parentItem.description = `${childItems.length} ${isFileView ? "Tag" : "File"}${multiplicity(
				childItems,
			)} > ${childMemoCount} Memo${multiplicity(childMemoCount)}`;
			parentItem.tooltip = `${isFileView ? "File" : "Tag"}: ${parentItem.label} - ${ //use markdown strin
				childItems.length
			}C${childMemoCount}M`;
		}
		return items;
	}
}

type ParentItemType = File | Tag;
type ExplorerTreeItem = CompletionItem | ParentItemType | Memo;

class CompletionItem extends vscode.TreeItem {
	readonly hierarchy: "parent" | "child";

	private confirmCompleteTimeout = false;

	constructor(label: string, expand: boolean | "none", public parent?: ParentItem) {
		let collapsibleState;
		if (expand === "none") collapsibleState = vscode.TreeItemCollapsibleState.None;
		else collapsibleState = expand ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
		super(label, collapsibleState);
		this.hierarchy = parent ? "parent" : "child";
	}
	confirmHandle(viewProvider: ExplorerViewProvider, labelOptions: { words?: number, maxLength: number }, confirmIcon: vscode.ThemeIcon, confirmContext: string, noConfirm?: boolean) {
		if (!noConfirm && configMaid.get("view.confirmCompleteMemo")) {
			const timeout = configMaid.get("view.confirmCompleteTimeout");
			if (!this.confirmCompleteTimeout) {
				this.confirmCompleteTimeout = true;
				const [label, desc, icon, context] = [this.label, this.description, this.iconPath, this.contextValue];
				this.label = `${this.label.toString().split(/\s/, labelOptions.words ?? 1).join(" ").slice(0, labelOptions.maxLength)}...`;
				this.iconPath = confirmIcon;
				this.contextValue = confirmContext;
	
				let time = Math.round(timeout / 1000);
				const updateTime = (time: number) => {
					this.description = `Confirm in ${time}`;
					viewProvider.refresh(this);
				};
				updateTime(time);
				const updateTimeout = setInterval(() => updateTime(--time), timeout / time);
	
				setTimeout(() => {
					clearInterval(updateTimeout);
					[this.label, this.description, this.iconPath, this.contextValue] = [label, desc, icon, context];
					this.confirmCompleteTimeout = false;
				}, timeout);
				return true;
			}
			this.confirmCompleteTimeout = false;
		}
		return false;
	}
}

class ParentItem extends CompletionItem {
	children: ExplorerTreeItem[] = [];
	constructor(label: string, expand: boolean, parent?: ParentItem) {super(label, expand, parent);}
	getChildItems() {
		return this.children;
	}
	setChildItems(items: ExplorerTreeItem[]) {
		this.children = items;
	}
}
class File extends ParentItem {
	readonly confirmCompleteIconColor = new vscode.ThemeColor("icon.foreground");
	readonly confirmCompleteIcon = new vscode.ThemeIcon("loading~spin", this.confirmCompleteIconColor);

	constructor(readonly path: string, expand: boolean, parent?: ParentItem) {
		super(vscode.workspace.asRelativePath(path), expand, parent);
		//what if I set desc to true?
		this.resourceUri = vscode.Uri.file(path);
		this.iconPath = vscode.ThemeIcon.File;
		this.contextValue = "file";
	}

	navigate() {
		vscode.workspace.openTextDocument(this.path).then((doc) => {
			vscode.window.showTextDocument(doc).then((editor) => {
				let pos = doc.lineAt(0).range.end;
				editor.selection = new vscode.Selection(pos, pos);
				editor.revealRange(new vscode.Range(pos, pos));
			});
		});
	}
	complete(viewProvider: ExplorerViewProvider, noConfirm?: boolean) {
		if (this.confirmHandle(viewProvider, { maxLength: 15 }, this.confirmCompleteIcon, "fileWaitingForConfirmComplete", noConfirm)) return;
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
		// 		if (editor.document === doc) {
		// 			editor.revealRange(new vscode.Range(start, start));
		// 			editor.selection = new vscode.Selection(start, start);
		// 		}
		// 	});
		// 	deleteItem(this, viewProvider);
		// });
		// viewProvider.refresh();
	}
}
class Tag extends ParentItem {
	readonly idleIconColor = new vscode.ThemeColor("icon.foreground");
	readonly idleIcon = new vscode.ThemeIcon("tag", this.idleIconColor);
	readonly confirmCompleteIconColor = new vscode.ThemeColor("icon.foreground");
	readonly confirmCompleteIcon = new vscode.ThemeIcon("loading~spin", this.confirmCompleteIconColor);

	constructor(tag: string, expand: boolean, parent?: ParentItem) {
		super(tag, expand, parent);

		this.iconPath = this.idleIcon;
		this.contextValue = "tag";
	}
}

class Memo extends CompletionItem {
	readonly idleIconColor = new vscode.ThemeColor("icon.foreground");
	readonly idleIcon = new vscode.ThemeIcon("circle-filled", this.idleIconColor);
	readonly confirmCompleteIconColor = new vscode.ThemeColor("icon.foreground"); //use memo priority color
	readonly confirmCompleteIcon = new vscode.ThemeIcon("loading~spin", this.confirmCompleteIconColor);

	constructor(public memoEntry: MemoEntry, parent: ParentItem) {
		const content = memoEntry.content === "" ? "Placeholder T^T" : memoEntry.content;
		super(content, "none", parent);

		this.description = `Ln ${memoEntry.line + 1}`;
		this.tooltip = `${memoEntry.tag} ~ ${memoEntry.relativePath} - Ln ${memoEntry.line + 1}\n${content}`; //use markdown string
		this.iconPath = this.idleIcon;
		this.contextValue = "memo";
		this.command = {
			command: "better-memo.navigateToMemo",
			title: "Navigate to Memo",
			tooltip: "Navigate to Memo",
			arguments: [memoEntry],
		};
	}

	async complete(viewProvider: ExplorerViewProvider, noConfirm?: boolean) {
		if (this.confirmHandle(viewProvider, { words: 3, maxLength: 12 }, this.confirmCompleteIcon, "memoWaitingForConfirmComplete", noConfirm)) return;
		const memo = this.memoEntry;
		await vscode.workspace.openTextDocument(memo.path).then((doc) => {
			const removeLine =
				memo.line < doc.lineCount - 1 &&
				doc
					.lineAt(memo.line)
					.text.replace(new RegExp(`${reEscape(memo.raw)}|${reEscape(getFormattedMemo(memo))}`), "")
					.trim().length === 0;
			const start = doc.positionAt(memo.offset);
			const end = removeLine ? new vscode.Position(memo.line + 1, 0) : start.translate(0, memo.rawLength);
			const range = new vscode.Range(start, end);
			const edit = new FE.FileEdit();
			edit.delete(doc.uri, range);
			edit.apply({ isRefactoring: true }, false, configMaid.get("view.alwaysOpenFileOnCompleteSingleMemo")).then(() => {
				const editor = vscode.window.activeTextEditor;
				if (editor.document === doc) {
					editor.revealRange(new vscode.Range(start, start));
					editor.selection = new vscode.Selection(start, start);
				}
			});
			deleteItem(this, viewProvider);
		});
		viewProvider.refresh();
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

function deleteItem(item: ExplorerTreeItem, viewProvider: ExplorerViewProvider) {
	const parent = item.parent ?? viewProvider;
	//@ts-ignore
	parent.setChildItems(parent.getChildItems().filter((_item) => _item !== item));
	if (!item.parent) return;
	if (parent.getChildItems().length === 0) deleteItem(<ExplorerTreeItem>parent, viewProvider);
}

const reEscape = (str?: string) => str?.replace(/[[\]*+?{}.()^$|/\\-]/g, "\\$&");
