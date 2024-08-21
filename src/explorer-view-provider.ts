import * as vscode from "vscode";
import { EE } from "./utils/event-emitter";
import { FE } from "./utils/file-edit";
import { getConfigMaid } from "./utils/config-maid";
import { getColorMaid } from "./utils/color-maid";
import { Janitor } from "./utils/janitor";
import { MemoFetcher, MemoEntry, getFormattedMemo } from "./memo-fetcher";

const eventEmitter = EE.getEventEmitter();
const configMaid = getConfigMaid();
const colorMaid = getColorMaid();

export class ExplorerTreeView {
	public memoFetcher: MemoFetcher;
	public viewProvider: ExplorerViewProvider;

	private view: vscode.TreeView<ExplorerTreeItem>;
	private janitor = new Janitor();

	async init(memoFetcher: MemoFetcher) {
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
			vscode.commands.registerCommand("better-memo.navigateToMemo", (memo: MemoEntry) => this.navigateToMemo(memo)),
			vscode.commands.registerCommand("better-memo.navigateToFile", (file: File) => file.navigate()),
			vscode.commands.registerCommand("better-memo.completeMemo", (memo: Memo) => memo.complete(this)),
			vscode.commands.registerCommand("better-memo.confirmCompleteMemo", (memo: Memo) => memo.complete(this)),
			vscode.commands.registerCommand("better-memo.completeMemoNoConfirm", (memo: Memo) => memo.complete(this, true)),
		);
		vscode.commands.executeCommand("setContext", "better-memo.explorerInitFinished", true);
	}
	dispose() {
		this.janitor.clearAll();
	}

	private updateViewType(view?: "File" | "Tag", noReload?: boolean) {
		this.viewProvider.currentView = view ?? configMaid.get("view.defaultView");
		vscode.commands.executeCommand(
			"setContext",
			`better-memo.explorerIs${view === "File" ? "Tag" : "File"}View`,
			false,
		);
		vscode.commands.executeCommand("setContext", `better-memo.explorerIs${view}View`, true);
		if (noReload) return;
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
	items: InnerItemType[] = [];
	memoCount = 0;
	currentView: "File" | "Tag";
	private _onDidChangeTreeData: vscode.EventEmitter<void | ExplorerTreeItem> =
		new vscode.EventEmitter<void | ExplorerTreeItem>();
	readonly onDidChangeTreeData: vscode.Event<void | ExplorerTreeItem> = this._onDidChangeTreeData.event;

	constructor(private _memoFetcher: MemoFetcher) {}
	async init() {
		await eventEmitter.wait("fetcherInitFinished").then(() => this.reloadItems());
	}
	getChildItems() {
		return this.items;
	}
	setChildItems(items: InnerItemType[]) {
		this.items = items;
	}
	getTreeItem(element: ExplorerTreeItem) {
		return element;
	}
	getParent(element: ExplorerTreeItem) {
		return element.parent;
	}
	getChildren(element: InnerItemType | undefined) {
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
		const inner = groupObjects(memos, isFileView ? "path" : "tag");
		const innerLabels = Object.keys(inner).sort();
		const innerItems = innerLabels.map((label) => new (isFileView ? File : Tag)(label, expandPrimaryGroup));

		for (let i = 0; i < innerLabels.length; i++) {
			const halfLeaves = groupObjects(inner[innerLabels[i]], isFileView ? "tag" : "path");
			const halfLeafLabels = Object.keys(halfLeaves).sort();

			const innerItem = innerItems[i];
			const halfLeafItems = halfLeafLabels.map(
				(label) => new (isFileView ? Tag : File)(label, expandSecondaryGroup, innerItem),
			);
			innerItem.children = halfLeafItems;

			let childMemoCount = 0;
			for (let j = 0; j < innerItem.children.length; j++) {
				let memos = halfLeaves[halfLeafLabels[j]].sort((a, b) => a._offset - b._offset);
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
				const halfLeafItem = innerItem.children[j];
				const tagColor = (<vscode.ThemeIcon>(isFileView ? halfLeafItem : innerItem).iconPath).color;
				const memoItems = memos.map((memoEntry) => new Memo(<MemoEntry>memoEntry, <InnerItemType>halfLeafItem, tagColor, this._memoFetcher.maxPriority));
				(<InnerItemType>halfLeafItem).children = memoItems;
				childMemoCount += memoItems.length;

				halfLeafItem.description = `${memoItems.length} Memo${multiplicity(memoItems)}`;
				halfLeafItem.tooltip = new vscode.MarkdownString(
					`${isFileView ? "Tag" : "File"}: ${halfLeafItem.label} - ${memoItems.length} $(edit)`,
					true,
				);
			}

			innerItem.description = `${halfLeafItems.length} ${isFileView ? "Tag" : "File"}${multiplicity(
				halfLeafItems,
			)} > ${childMemoCount} Memo${multiplicity(childMemoCount)}`;
			innerItem.tooltip = new vscode.MarkdownString(
				`${isFileView ? "File" : "Tag"}: ${innerItem.label} - ${halfLeafItems.length} ${
					isFileView ? "$(bookmark)" : "$(file)"
				} ${childMemoCount} $(edit)`,
				true,
			);
		}
		return innerItems;
	}
}

type InnerItemType = File | Tag;
type ExplorerTreeItem = CompletableItem | InnerItemType | Memo;

class CompletableItem extends vscode.TreeItem {
	static readonly confirmIconPhase1 = new vscode.ThemeIcon("loading~spin", new vscode.ThemeColor("#fffb00"));
	static readonly confirmIconPhase2 = new vscode.ThemeIcon("loading~spin", new vscode.ThemeColor("#43ff00"));
	static readonly confirmIconPhase3 = new vscode.ThemeIcon("loading~spin", new vscode.ThemeColor("#00fff2"));

	readonly hierarchy: "parent" | "child";

	private attemptedToComplete = false;
	private confirmInterval: NodeJS.Timeout;
	private confirmTimeout: NodeJS.Timeout;

	constructor(label: string, expand: boolean | "none", public parent?: InnerItem) {
		let collapsibleState;
		if (expand === "none") collapsibleState = vscode.TreeItemCollapsibleState.None;
		else
			collapsibleState = expand ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
		super(label, collapsibleState);
		this.hierarchy = parent ? "parent" : "child";
	}
	confirmHandle(
		explorerTreeView: ExplorerTreeView,
		labelOptions: { words?: number; maxLength: number },
		confirmContext: string,
		noConfirm?: boolean,
	) {
		if (!noConfirm && configMaid.get("view.confirmCompleteMemo")) {
			clearTimeout(this.confirmTimeout);
			clearInterval(this.confirmInterval);
			explorerTreeView.memoFetcher.unsuppressForceScan();

			if (this.attemptedToComplete) {
				this.attemptedToComplete = false;
				return true;
			}
			this.attemptedToComplete = true;

			const [label, desc, icon, context] = [this.label, this.description, this.iconPath, this.contextValue];
			let abbrevLabel = `${this.label
				.toString()
				.split(/\s/, labelOptions.words ?? 1)
				.join(" ")}`;
			if (abbrevLabel.length > labelOptions.maxLength)
				abbrevLabel = `${abbrevLabel.slice(0, labelOptions.maxLength)}...`;
			this.label = abbrevLabel;
			this.iconPath = CompletableItem.confirmIconPhase1;
			this.contextValue = confirmContext;

			explorerTreeView.memoFetcher.suppressForceScan();

			const timeout = configMaid.get("view.confirmCompleteTimeout");
			let time = timeout;
			const updateTime = (time: number) => {
				this.description = `Confirm in ${Math.round(time / 1000)}`;
				if (time / timeout < 0.33) this.iconPath = CompletableItem.confirmIconPhase3;
				else if (time / timeout < 0.66) this.iconPath = CompletableItem.confirmIconPhase2;
				explorerTreeView.viewProvider.refresh(this);
			};
			updateTime(timeout);
			this.confirmInterval = setInterval(() => updateTime((time -= 1000)), timeout / Math.round(time / 1000));

			this.confirmTimeout = setTimeout(() => {
				this.attemptedToComplete = false;
				clearInterval(this.confirmInterval);

				[this.label, this.description, this.iconPath, this.contextValue] = [label, desc, icon, context];
				explorerTreeView.viewProvider.refresh(this);
				explorerTreeView.memoFetcher.unsuppressForceScan();
			}, timeout);
			return false;
		}
		return true;
	}
}

class InnerItem extends CompletableItem {
	children: ExplorerTreeItem[] = [];
	constructor(label: string, expand: boolean, parent?: InnerItem) {
		super(label, expand, parent);
	}
	getChildItems() {
		return this.children;
	}
	setChildItems(items: ExplorerTreeItem[]) {
		this.children = items;
	}
}
class File extends InnerItem {
	constructor(readonly path: string, expand: boolean, parent?: InnerItem) {
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
	// 		if (editor.document === doc) {
	// 			editor.revealRange(new vscode.Range(start, start));
	// 			editor.selection = new vscode.Selection(start, start);
	// 		}
	// 	});
	// 	deleteItem(this, viewProvider);
	// });
	// viewProvider.refresh();
	// }
}
class Tag extends InnerItem {
	readonly idleIconColor = colorMaid.hashColor(this.label.toString());
	readonly idleIcon = new vscode.ThemeIcon("bookmark", this.idleIconColor);

	constructor(tag: string, expand: boolean, parent?: InnerItem) {
		super(tag, expand, parent);

		this.iconPath = this.idleIcon;
		this.contextValue = "tag";
	}
}

class Memo extends CompletableItem {
	constructor(public memoEntry: MemoEntry, parent: InnerItem, tagColor: vscode.ThemeColor, maxPriority: number) {
		const content = memoEntry.content === "" ? "Placeholder T^T" : memoEntry.content;
		super(content, "none", parent);

		this.description = `Ln ${memoEntry.line + 1}`;
		this.tooltip = `${memoEntry.tag} ~ ${memoEntry.relativePath} - Ln ${memoEntry.line + 1}\n${content}`; //use markdown string
		this.contextValue = "memo";
		this.command = {
			command: "better-memo.navigateToMemo",
			title: "Navigate to Memo",
			tooltip: "Navigate to Memo",
			arguments: [memoEntry],
		};
		let iconColor = memoEntry.priority === 0 ? tagColor : colorMaid.interpolate([255, (1 - memoEntry.priority / maxPriority) * 255, 0]);
		this.iconPath = new vscode.ThemeIcon("circle-filled", iconColor);
	}

	complete(explorerTreeView: ExplorerTreeView, noConfirm?: boolean) {
		if (!this.confirmHandle(explorerTreeView, { words: 3, maxLength: 12 }, "memoWaitingForConfirmComplete", noConfirm))
			return;
		const memo = this.memoEntry;
		vscode.workspace.openTextDocument(memo.path).then((doc) => {
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
			explorerTreeView.viewProvider.refresh(deleteItem(this, explorerTreeView.viewProvider));
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

function deleteItem(item: ExplorerTreeItem, viewProvider: ExplorerViewProvider) {
	const parent = item.parent ?? viewProvider;
	//@ts-ignore
	parent.setChildItems(parent.getChildItems().filter((_item) => _item !== item));
	if (item.parent && parent.getChildItems().length === 0) deleteItem(<ExplorerTreeItem>parent, viewProvider);
	return item.parent;
}

const reEscape = (str?: string) => str?.replace(/[[\]*+?{}.()^$|/\\-]/g, "\\$&");
