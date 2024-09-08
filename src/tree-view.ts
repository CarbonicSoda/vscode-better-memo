import {
	commands,
	Event,
	MarkdownString,
	ThemeIcon,
	TreeDataProvider,
	TreeView as vsTreeView,
	EventEmitter as vsEventEmitter,
	window,
} from "vscode";
import { TreeItems } from "./tree-items";
import { MemoEntry, MemoFetcher } from "./memo-fetcher";
import { Aux } from "./utils/auxiliary";
import { ConfigMaid } from "./utils/config-maid";
import { EvEmitter } from "./utils/event-emitter";
import { Janitor } from "./utils/janitor";

let configMaid: ConfigMaid;
let eventEmitter: EvEmitter.EventEmitter;

export type TreeView = typeof treeView;

export async function getTreeView(): Promise<typeof treeView> {
	return treeView;
}

const treeView: {
	memoFetcher?: MemoFetcher;
	viewProvider?: ViewProvider;

	init(memoFetcher: MemoFetcher): Promise<void>;
	dispose(): Promise<void>;

	explorerExpandAll(): Promise<void>;
	explorerCompleteAll(): Promise<void>;

	updateViewType(view?: "File" | "Tag", options?: { noReload?: boolean }): Promise<void>;
	updateItemCollapsibleState(): Promise<void>;
	handleChangeVisibility(visible: boolean): Promise<void>;

	view?: vsTreeView<TreeItems.TreeItemType>;
	janitor: Janitor;
} = {
	async init(memoFetcher: MemoFetcher): Promise<void> {
		if (!resolved) throw moduleUnresolvedError;

		this.memoFetcher = memoFetcher;
		this.viewProvider = new ViewProvider(memoFetcher);
		await this.updateViewType(null, { noReload: true });
		await this.viewProvider.init();
		this.view = window.createTreeView("better-memo.memoExplorer", {
			treeDataProvider: this.viewProvider,
			showCollapseAll: true,
			canSelectMany: false,
		});

		await Promise.all([
			configMaid.onChange("view.defaultView", async (view: "File" | "Tag") => await this.updateViewType(view)),
			configMaid.onChange(
				["view.expandPrimaryItemsByDefault", "view.expandSecondaryItemsByDefault"],
				async () => await this.updateItemCollapsibleState(),
			),
		]);

		await this.janitor.add(
			this.view,

			eventEmitter.subscribe("updateView", async () => await this.viewProvider.reloadItems()),

			window.onDidChangeActiveColorTheme(async () => await this.viewProvider.reloadItems()),

			this.view.onDidChangeVisibility(async (ev) => await this.handleChangeVisibility(ev.visible)),

			commands.registerCommand("better-memo.switchToFileView", async () => await this.updateViewType("File")),
			commands.registerCommand("better-memo.switchToTagView", async () => await this.updateViewType("Tag")),
			commands.registerCommand("better-memo.explorerCompleteAll", async () => await this.explorerCompleteAll()),
			commands.registerCommand("better-memo.explorerExpandAll", async () => await this.explorerExpandAll()),

			commands.registerCommand(
				"better-memo.navigateToFile",
				async (fileItem: TreeItems.FileItem) => await fileItem.navigate(),
			),
			commands.registerCommand(
				"better-memo.completeFile",
				async (fileItem: TreeItems.FileItem) => await fileItem.completeMemos(this),
			),
			commands.registerCommand(
				"better-memo.completeFileNoConfirm",
				async (fileItem: TreeItems.FileItem) => await fileItem.completeMemos(this, { noConfirmation: true }),
			),

			commands.registerCommand(
				"better-memo.completeTag",
				async (tagItem: TreeItems.TagItem) => await tagItem.completeMemos(this),
			),
			commands.registerCommand(
				"better-memo.completeTagNoConfirm",
				async (tagItem: TreeItems.TagItem) => await tagItem.completeMemos(this, { noConfirmation: true }),
			),

			commands.registerCommand(
				"better-memo.navigateToMemo",
				async (memoItem: TreeItems.MemoItem) => await memoItem.navigate(),
			),
			commands.registerCommand(
				"better-memo.completeMemo",
				async (memoItem: TreeItems.MemoItem) => await memoItem.complete(this),
			),
			commands.registerCommand(
				"better-memo.confirmCompleteMemo",
				async (memoItem: TreeItems.MemoItem) => await memoItem.complete(this),
			),
			commands.registerCommand(
				"better-memo.completeMemoNoConfirm",
				async (memoItem: TreeItems.MemoItem) => await memoItem.complete(this, { noConfirmation: true }),
			),
		);

		await commands.executeCommand("setContext", "better-memo.explorerInitFinished", true);
	},

	async dispose(): Promise<void> {
		await this.janitor.dispose();
	},

	async explorerExpandAll(): Promise<void> {
		for (const item of this.viewProvider.items) this.view.reveal(item, { select: false, expand: 2 });
	},

	async explorerCompleteAll(): Promise<void> {
		const { memoFetcher, viewProvider } = this;
		await memoFetcher.suppressForceScan();
		const memoCount = viewProvider.memoCount;
		const items = viewProvider.items;
		const completionDetails = `Are you sure you want to proceed?
			This will mark all ${memoCount} memo${await Aux.plural(memoCount)} ${
			viewProvider.viewType === "File" ? "in" : "under"
		} ${items.length} ${viewProvider.viewType.toLowerCase()}${await Aux.plural(items)} as completed.`;
		const option = await window.showInformationMessage(
			"Confirm Completion of Memos",
			{ modal: true, detail: completionDetails },
			"Yes",
			"No",
		);
		if (!option || option === "No") {
			await memoFetcher.unsuppressForceScan();
			return;
		}
		for (const item of items) await item.completeMemos(this, { noConfirmation: true, _noExtraTasks: true });
		await memoFetcher.removeAllMemos();
		await viewProvider.removeAllItems();
		await viewProvider.refresh();
	},

	async updateViewType(view?: "File" | "Tag", options?: { noReload?: boolean }): Promise<void> {
		this.viewProvider.viewType = view = view ?? (await configMaid.get("view.defaultView"));
		await commands.executeCommand("setContext", "better-memo.explorerView", view);
		if (options?.noReload) return;
		await this.viewProvider.reloadItems();
	},

	async updateItemCollapsibleState(): Promise<void> {
		const expandPrimaryItems = await configMaid.get("view.expandPrimaryItemsByDefault");
		const expandSecondaryItems = await configMaid.get("view.expandSecondaryItemsByDefault");
		const onViewReveal = async () =>
			await commands.executeCommand("list.collapseAll").then(async () => {
				if (expandSecondaryItems) {
					const uRevealPromises = [];
					for (const child of this.viewProvider.items.flatMap((item) => item.children))
						uRevealPromises.push(this.view.reveal(child, { select: false, expand: true }));
					await Promise.allSettled(uRevealPromises);
				}
				for (const item of this.viewProvider.items) {
					if (expandPrimaryItems) {
						this.view.reveal(item, { select: false, expand: true });
						continue;
					}
					await this.view.reveal(item, { select: false, focus: true });
					await commands.executeCommand("list.collapse");
				}
				await this.view.reveal(this.viewProvider.items[0], {
					select: false,
					focus: true,
				});
			});
		await this.view
			.reveal(this.viewProvider.items[0], { select: false, focus: true })
			.then(onViewReveal, async () => null);
	},

	async handleChangeVisibility(visible: boolean): Promise<void> {
		if (visible) {
			await this.memoFetcher.disableBackgroundMode();
			return;
		}
		await this.memoFetcher.enableBackgroundMode();
	},

	janitor: new Janitor(),
};

export class ViewProvider implements TreeDataProvider<TreeItems.TreeItemType> {
	viewType: "File" | "Tag";
	items: TreeItems.InnerItemType[] = [];
	memoCount = 0;

	private _onDidChangeTreeData: vsEventEmitter<void | undefined | TreeItems.TreeItemType> = new vsEventEmitter<
		void | undefined | TreeItems.TreeItemType
	>();
	readonly onDidChangeTreeData: Event<void | undefined | TreeItems.TreeItemType> = this._onDidChangeTreeData.event;

	constructor(private memoFetcher: MemoFetcher) {
		if (!resolved) throw moduleUnresolvedError;
	}

	async init(): Promise<void> {
		await eventEmitter.wait("initExplorerView", async () => await this.reloadItems());
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
		for (const item of items) {
			if (!this.items.includes(item)) continue;
			const itemIndex = this.items.indexOf(item);
			this.items = this.items.filter((_, i) => i !== itemIndex);
		}
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
		const expandPrimaryGroup = await configMaid.get("view.expandPrimaryItemsByDefault");
		const expandSecondaryGroup = await configMaid.get("view.expandSecondaryItemsByDefault");

		const memos = await this.memoFetcher.getMemos();
		const tags = await this.memoFetcher.getTags();
		this.memoCount = memos.length;

		const inner = await Aux.groupObjects(memos, isFileView ? "path" : "tag");
		const innerLabels = Object.keys(inner).sort();
		const uInnerItems = innerLabels.map(
			async (label) => new (isFileView ? TreeItems.FileItem : TreeItems.TagItem)(label, expandPrimaryGroup),
		);
		const innerItems: TreeItems.InnerItemType[] = await Promise.all(uInnerItems);

		for (let i = 0; i < innerLabels.length; i++) {
			const innerLabel = innerLabels[i];
			const innerItem = innerItems[i];
			if (!isFileView) innerItem.iconPath = new ThemeIcon("bookmark", tags[innerLabel]);

			const halfLeaves = await Aux.groupObjects(inner[innerLabel], isFileView ? "tag" : "path");
			const halfLeafLabels = Object.keys(halfLeaves).sort();
			const uHalfLeafItems = isFileView
				? halfLeafLabels.map(
						async (label) =>
							new TreeItems.TagItem(label, expandSecondaryGroup, <TreeItems.FileItem>innerItem),
				  )
				: halfLeafLabels.map(
						async (label) =>
							new TreeItems.FileItem(label, expandSecondaryGroup, <TreeItems.TagItem>innerItem),
				  );
			const halfLeafItems: TreeItems.InnerItemType[] = await Promise.all(uHalfLeafItems);
			innerItem.children = halfLeafItems;

			let childMemoCount = 0;
			for (let j = 0; j < innerItem.children.length; j++) {
				const halfLeafItem = innerItem.children[j];
				const halfLeafLabel = halfLeafLabels[j];
				if (isFileView) halfLeafItem.iconPath = new ThemeIcon("bookmark", tags[halfLeafLabel]);

				let memos = (<MemoEntry[]>halfLeaves[halfLeafLabel]).sort((a, b) => a.offset - b.offset);
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

				const tagColor = (<ThemeIcon>(isFileView ? halfLeafItem : innerItem).iconPath).color;
				const maxPriority = Math.max(...memos.map((memo) => memo.priority));
				const uMemoItems = memos.map(async (memo) => {
					const memoItem = new TreeItems.MemoItem(memo, <TreeItems.InnerItemType>halfLeafItem);
					await memoItem.setIcon(tagColor, maxPriority);
					return memoItem;
				});
				const memoItems = await Promise.all(uMemoItems);
				(<TreeItems.InnerItemType>halfLeafItem).children = memoItems;
				childMemoCount += memoItems.length;

				halfLeafItem.description = `${memoItems.length} Memo${await Aux.plural(memoItems)}`;
				halfLeafItem.tooltip = new MarkdownString(
					`${isFileView ? "Tag: " : "File: *"}${halfLeafItem.label}${isFileView ? "" : "*"} - ${
						memoItems.length
					} $(pencil)`,
					true,
				);
			}

			innerItem.description = `${halfLeafItems.length} ${isFileView ? "Tag" : "File"}${await Aux.plural(
				halfLeafItems,
			)} > ${childMemoCount} Memo${await Aux.plural(childMemoCount)}`;
			innerItem.tooltip = new MarkdownString(
				`${isFileView ? "File: *" : "Tag: "}${innerItem.label}${isFileView ? "*" : ""} - ${
					halfLeafItems.length
				} ${isFileView ? "$(bookmark)" : "$(file)"} ${childMemoCount} $(pencil)`,
				true,
			);
		}

		return innerItems;
	}
}

let resolved = false;
const moduleUnresolvedError = new Error("module tree-view is not resolved");
export async function resolver(): Promise<void> {
	if (resolved) return;
	resolved = true;

	configMaid = new ConfigMaid();
	eventEmitter = await EvEmitter.getEventEmitter();

	await Promise.all([
		configMaid.listen("view.defaultView"),
		configMaid.listen("view.expandPrimaryItemsByDefault"),
		configMaid.listen("view.expandSecondaryItemsByDefault"),
	]);
}
