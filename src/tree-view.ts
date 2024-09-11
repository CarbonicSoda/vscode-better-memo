import {
	commands,
	Event,
	MarkdownString,
	ThemeIcon,
	TreeDataProvider,
	TreeView as vsTreeView,
	EventEmitter as vsEventEmitter,
	window,
	TreeViewVisibilityChangeEvent,
} from "vscode";
import { Aux } from "./utils/auxiliary";
import { Janitor, getJanitor } from "./utils/janitor";
import { ConfigMaid, getConfigMaid } from "./utils/config-maid";
import { EventEmitter, getEventEmitter } from "./utils/event-emitter";
import { MemoEntry, MemoEngine } from "./memo-engine";
import { TreeItems } from "./tree-items";

export type TreeView = typeof treeView;

export async function getTreeView(): Promise<TreeView> {
	return treeView;
}

const treeView: {
	memoEngine?: MemoEngine;
	viewProvider?: ViewProvider;
	view?: vsTreeView<TreeItems.TreeItemType>;

	init(memoEngine: MemoEngine): Promise<void>;

	explorerExpandAll(): Promise<void>;
	explorerCompleteAll(): Promise<void>;

	viewUpdateSuppressed: boolean;
	suppressViewUpdate(): Promise<void>;
	unsuppressViewUpdate(): Promise<void>;

	updateView(): Promise<void>;
	updateViewType(view?: "File" | "Tag", options?: { noReload?: boolean }): Promise<void>;
	updateExpandStateOfItems(): Promise<void>;
	handleVisibilityChange(visible: boolean): Promise<void>;

	janitor?: Janitor;
	configMaid?: ConfigMaid;
	eventEmitter?: EventEmitter;
} = {
	viewUpdateSuppressed: false,

	async init(memoEngine: MemoEngine): Promise<void> {
		treeView.janitor = await getJanitor();
		treeView.configMaid = await getConfigMaid();
		treeView.eventEmitter = await getEventEmitter();

		await Aux.promise.all(
			treeView.configMaid.listen("view.defaultView"),
			treeView.configMaid.listen("view.expandPrimaryItemsByDefault"),
			treeView.configMaid.listen("view.expandSecondaryItemsByDefault"),
		);

		treeView.memoEngine = memoEngine;
		treeView.viewProvider = new ViewProvider(memoEngine);
		await treeView.updateViewType(null, { noReload: true });
		await treeView.viewProvider.init();
		treeView.view = window.createTreeView("better-memo.memoExplorer", {
			treeDataProvider: treeView.viewProvider,
			showCollapseAll: true,
			canSelectMany: false,
		});

		await Aux.promise.all(
			treeView.configMaid.onChange(
				"view.defaultView",
				async (view: "File" | "Tag") => await treeView.updateViewType(view),
			),
			treeView.configMaid.onChange(
				["view.expandPrimaryItemsByDefault", "view.expandSecondaryItemsByDefault"],
				async () => await treeView.updateExpandStateOfItems(),
			),
		);

		await treeView.janitor.add(
			treeView.view,

			treeView.eventEmitter.subscribe("updateView", async () => await treeView.updateView()),

			window.onDidChangeActiveColorTheme(async () => await treeView.updateView()),

			treeView.view.onDidChangeVisibility(
				async (ev: TreeViewVisibilityChangeEvent) => await treeView.handleVisibilityChange(ev.visible),
			),

			commands.registerCommand("better-memo.switchToFileView", async () => await treeView.updateViewType("File")),
			commands.registerCommand("better-memo.switchToTagView", async () => await treeView.updateViewType("Tag")),
			commands.registerCommand(
				"better-memo.explorerCompleteAll",
				async () => await treeView.explorerCompleteAll(),
			),
			commands.registerCommand("better-memo.explorerExpandAll", async () => await treeView.explorerExpandAll()),

			commands.registerCommand(
				"better-memo.navigateToFile",
				async (fileItem: TreeItems.FileItem) => await fileItem.navigateTo(),
			),
			commands.registerCommand(
				"better-memo.completeFile",
				async (fileItem: TreeItems.FileItem) => await fileItem.markMemosAsComplete(treeView),
			),
			commands.registerCommand(
				"better-memo.completeFileNoConfirm",
				async (fileItem: TreeItems.FileItem) =>
					await fileItem.markMemosAsComplete(treeView, { noConfirmation: true }),
			),

			commands.registerCommand(
				"better-memo.completeTag",
				async (tagItem: TreeItems.TagItem) => await tagItem.markMemosAsComplete(treeView),
			),
			commands.registerCommand(
				"better-memo.completeTagNoConfirm",
				async (tagItem: TreeItems.TagItem) =>
					await tagItem.markMemosAsComplete(treeView, { noConfirmation: true }),
			),

			commands.registerCommand(
				"better-memo.navigateToMemo",
				async (memoItem: TreeItems.MemoItem) => await memoItem.navigateTo(),
			),
			commands.registerCommand(
				"better-memo.completeMemo",
				async (memoItem: TreeItems.MemoItem) => await memoItem.markAsComplete(treeView),
			),
			commands.registerCommand(
				"better-memo.confirmCompleteMemo",
				async (memoItem: TreeItems.MemoItem) => await memoItem.markAsComplete(treeView),
			),
			commands.registerCommand(
				"better-memo.completeMemoNoConfirm",
				async (memoItem: TreeItems.MemoItem) =>
					await memoItem.markAsComplete(treeView, { noConfirmation: true }),
			),
		);

		await commands.executeCommand("setContext", "better-memo.explorerInitFinished", true);
	},

	async explorerExpandAll(): Promise<void> {
		await Aux.async.map(
			treeView.viewProvider.items,
			async (item) => await treeView.view.reveal(item, { select: false, expand: 2 }),
		);
	},

	async explorerCompleteAll(): Promise<void> {
		const { memoEngine, viewProvider } = treeView;
		await treeView.suppressViewUpdate();
		const memoCount = viewProvider.memoCount;
		const items = viewProvider.items;

		const completionDetails = `Are you sure you want to proceed?
			This will mark all ${memoCount} memo${await Aux.string.plural(memoCount)} ${
			viewProvider.viewType === "File" ? "in" : "under"
		} ${items.length} ${viewProvider.viewType.toLowerCase()}${await Aux.string.plural(items)} as completed.`;
		const option = await window.showInformationMessage(
			"Confirm Completion of Memos",
			{ modal: true, detail: completionDetails },
			"Yes",
			"No",
		);
		if (!option || option === "No") {
			await treeView.unsuppressViewUpdate();
			return;
		}

		for (const item of items)
			await item.markMemosAsComplete(treeView, { noConfirmation: true, _noExtraTasks: true });
		await memoEngine.removeAllMemos();
		await viewProvider.removeAllItems();
		await viewProvider.refresh();
		await treeView.unsuppressViewUpdate();
	},

	async suppressViewUpdate(): Promise<void> {
		treeView.viewUpdateSuppressed = true;
	},

	async unsuppressViewUpdate(): Promise<void> {
		treeView.viewUpdateSuppressed = false;
	},

	async updateView(): Promise<void> {
		if (treeView.viewUpdateSuppressed) return;
		await treeView.viewProvider.reloadItems();
	},

	async updateViewType(viewType?: "File" | "Tag", options?: { noReload?: boolean }): Promise<void> {
		if (treeView.viewUpdateSuppressed) return;
		treeView.viewProvider.viewType = viewType = viewType ?? (await treeView.configMaid.get("view.defaultView"));
		await commands.executeCommand("setContext", "better-memo.explorerView", viewType);
		if (options?.noReload) return;
		await treeView.viewProvider.reloadItems();
	},

	async updateExpandStateOfItems(): Promise<void> {
		const expandPrimaryItems = await treeView.configMaid.get("view.expandPrimaryItemsByDefault");
		const expandSecondaryItems = await treeView.configMaid.get("view.expandSecondaryItemsByDefault");

		const onViewReveal = async () => {
			await commands.executeCommand("list.collapseAll");
			if (expandSecondaryItems) {
				const uRevealPromises = [];
				await Aux.async.map(
					treeView.viewProvider.items.flatMap((item) => item.children),
					async (child) => uRevealPromises.push(treeView.view.reveal(child, { select: false, expand: true })),
				);
				await Promise.allSettled(uRevealPromises);
			}
			for (const item of treeView.viewProvider.items) {
				if (expandPrimaryItems) {
					treeView.view.reveal(item, { select: false, expand: true });
					continue;
				}
				await treeView.view.reveal(item, { select: false, focus: true });
				await commands.executeCommand("list.collapse");
			}
			await treeView.view.reveal(treeView.viewProvider.items[0], {
				select: false,
				focus: true,
			});
		};

		try {
			await treeView.view.reveal(treeView.viewProvider.items[0], { select: false, focus: true });
			await onViewReveal();
		} finally {
		}
	},

	async handleVisibilityChange(visible: boolean): Promise<void> {
		if (visible) {
			await treeView.memoEngine.leaveBackgroundMode();
			return;
		}
		await treeView.memoEngine.enterBackgroundMode();
	},
};

export class ViewProvider implements TreeDataProvider<TreeItems.TreeItemType> {
	viewType: "File" | "Tag";
	items: TreeItems.InnerItemType[] = [];
	memoCount = 0;

	private _onDidChangeTreeData: vsEventEmitter<void | undefined | TreeItems.TreeItemType> = new vsEventEmitter<
		void | undefined | TreeItems.TreeItemType
	>();
	readonly onDidChangeTreeData: Event<void | undefined | TreeItems.TreeItemType> = this._onDidChangeTreeData.event;

	constructor(private memoEngine: MemoEngine) {}

	async init(): Promise<void> {
		await treeView.eventEmitter.wait("initExplorerView", async () => await this.reloadItems());
	}

	async getTreeItem(element: TreeItems.TreeItemType): Promise<TreeItems.TreeItemType> {
		return element;
	}

	async getParent(element: TreeItems.TreeItemType): Promise<TreeItems.InnerItemType> {
		return element.parent;
	}

	async getChildren(element: TreeItems.InnerItemType | undefined): Promise<TreeItems.TreeItemType[]> {
		if (element) return element.children;
		return this.items;
	}

	async removeItems(...items: TreeItems.InnerItemType[]): Promise<void> {
		await Aux.async.map(items, async (item) => {
			if (!this.items.includes(item)) return;
			const itemIndex = this.items.indexOf(item);
			this.items = this.items.filter((_, i) => i !== itemIndex);
		});
	}

	async removeAllItems(): Promise<void> {
		this.items = [];
	}

	async reloadItems(): Promise<void> {
		this.items = await this.getItems();
		this._onDidChangeTreeData.fire();
	}

	async refresh(item?: TreeItems.TreeItemType): Promise<void> {
		this._onDidChangeTreeData.fire(item);
	}

	private async getItems(): Promise<TreeItems.InnerItemType[]> {
		const isFileView = this.viewType === "File";
		const expandPrimaryGroup = await treeView.configMaid.get("view.expandPrimaryItemsByDefault");
		const expandSecondaryGroup = await treeView.configMaid.get("view.expandSecondaryItemsByDefault");

		const memos = await this.memoEngine.getMemos();
		const tags = await this.memoEngine.getTags();
		this.memoCount = memos.length;
		if (this.memoCount === 0) return;

		const inner = await Aux.object.group(memos, isFileView ? "path" : "tag");
		const innerLabels = Object.keys(inner).sort();
		const innerItems: TreeItems.InnerItemType[] = await Aux.async.map(
			innerLabels,
			async (label) => new (isFileView ? TreeItems.FileItem : TreeItems.TagItem)(label, expandPrimaryGroup),
		);

		await Aux.async.range(innerLabels.length, async (i: number) => {
			const innerLabel = innerLabels[i];
			const innerItem = innerItems[i];
			if (!isFileView) innerItem.iconPath = new ThemeIcon("bookmark", tags[innerLabel]);

			const halfLeaves = await Aux.object.group(inner[innerLabel], isFileView ? "tag" : "path");
			const halfLeafLabels = Object.keys(halfLeaves).sort();
			const halfLeafItems: TreeItems.InnerItemType[] = isFileView
				? await Aux.async.map(
						halfLeafLabels,
						async (label) =>
							new TreeItems.TagItem(label, expandSecondaryGroup, <TreeItems.FileItem>innerItem),
				  )
				: await Aux.async.map(
						halfLeafLabels,
						async (label) =>
							new TreeItems.FileItem(label, expandSecondaryGroup, <TreeItems.TagItem>innerItem),
				  );
			innerItem.children = halfLeafItems;

			let childMemoCount = 0;
			await Aux.async.range(innerItem.children.length, async (j) => {
				const halfLeafItem = innerItem.children[j];
				const halfLeafLabel = halfLeafLabels[j];
				if (isFileView) halfLeafItem.iconPath = new ThemeIcon("bookmark", tags[halfLeafLabel]);

				let memos = (<MemoEntry[]>halfLeaves[halfLeafLabel]).sort((a, b) => a.offset - b.offset);
				const priority = [];
				const normal = [];
				await Aux.async.map(memos, async (memo) => {
					if (memo.priority !== 0) {
						priority.push(memo);
						return;
					}
					normal.push(memo);
				});
				memos = priority.sort((a, b) => b.priority - a.priority).concat(normal);

				const tagColor = (<ThemeIcon>(isFileView ? halfLeafItem : innerItem).iconPath).color;
				const maxPriority = Math.max(...memos.map((memo) => memo.priority));
				const memoItems = await Aux.async.map(memos, async (memo) => {
					const memoItem = new TreeItems.MemoItem(memo, <TreeItems.InnerItemType>halfLeafItem);
					await memoItem.setIcon(tagColor, maxPriority);
					return memoItem;
				});
				(<TreeItems.InnerItemType>halfLeafItem).children = memoItems;
				childMemoCount += memoItems.length;

				halfLeafItem.description = `${memoItems.length} Memo${await Aux.string.plural(memoItems)}`;
				halfLeafItem.tooltip = new MarkdownString(
					`${isFileView ? "Tag: " : "File: *"}${halfLeafItem.label}${isFileView ? "" : "*"} - ${
						memoItems.length
					} $(pencil)`,
					true,
				);
			});

			innerItem.description = `${halfLeafItems.length} ${isFileView ? "Tag" : "File"}${await Aux.string.plural(
				halfLeafItems,
			)} > ${childMemoCount} Memo${await Aux.string.plural(childMemoCount)}`;
			innerItem.tooltip = new MarkdownString(
				`${isFileView ? "File: *" : "Tag: "}${innerItem.label}${isFileView ? "*" : ""} - ${
					halfLeafItems.length
				} ${isFileView ? "$(bookmark)" : "$(file)"} ${childMemoCount} $(pencil)`,
				true,
			);
		});

		return innerItems;
	}
}
