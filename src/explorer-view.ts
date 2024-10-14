/**
 * Configs used in explorer-view.ts:
 * view.defaultView
 * view.defaultExpandPrimaryItems, view.defaultExpandSecondaryItems
 */

import {
	commands,
	MarkdownString,
	ThemeIcon,
	TreeDataProvider,
	TreeView,
	Event as vsEvent,
	EventEmitter as vsEventEmitter,
	window,
} from "vscode";
import { Aux } from "./utils/auxiliary";
import { ConfigMaid } from "./utils/config-maid";
import { EventEmitter } from "./utils/event-emitter";
import { Janitor } from "./utils/janitor";
import { MemoEngine } from "./memo-engine";
import { TreeItems } from "./tree-items";

/**
 * Provides Memo Explorer view on primary sidebar, main presentation module
 */
export namespace ExplorerView {
	/**
	 * Memo Explorer tree data provider
	 */
	class Provider implements TreeDataProvider<TreeItems.TreeItemType> {
		viewType: "File" | "Tag";
		items: TreeItems.InnerItemType[] = [];
		memoCount = 0;

		private treeDataChangeEmitter: vsEventEmitter<void | undefined | TreeItems.TreeItemType> = new vsEventEmitter<
			void | undefined | TreeItems.TreeItemType
		>();
		onDidChangeTreeData: vsEvent<void | undefined | TreeItems.TreeItemType> = this.treeDataChangeEmitter.event;

		/**
		 * Init provider and loads tree items
		 */
		async initProvider(): Promise<void> {
			this.viewType = ConfigMaid.get("view.defaultView");
			commands.executeCommand("setContext", "better-memo.explorerView", this.viewType);
			await this.reloadItems();
		}

		//Interface implementation methods

		getTreeItem(element: TreeItems.TreeItemType): TreeItems.TreeItemType {
			return element;
		}

		getParent(element: TreeItems.TreeItemType): TreeItems.InnerItemType {
			return element.parent;
		}

		getChildren(element: TreeItems.InnerItemType | undefined): TreeItems.TreeItemType[] {
			if (element) return element.children;
			return this.items;
		}

		//End of interface implementation methods

		/**
		 * Removes `items` from provider
		 */
		removeItems(...items: TreeItems.InnerItemType[]): void {
			this.items = Aux.array.removeFrom(this.items, ...items);
		}

		/**
		 * Removes all items from provider
		 */
		removeAllItems(): void {
			this.items = [];
		}

		/**
		 * Updates provider items (does not reload items)
		 * @param item item to be updated, if not given the whole tree is refreshed
		 */
		refresh(item?: TreeItems.TreeItemType): void {
			this.treeDataChangeEmitter.fire(item);
		}

		/**
		 * Reloads provider with updated items from {@link MemoEngine}
		 */
		async reloadItems(): Promise<void> {
			this.items = await this.getItems();
			this.treeDataChangeEmitter.fire();
		}

		/**
		 * Retrieves updated items from {@link MemoEngine} and builds explorer items
		 * @returns built inner items (primary-hierarchy)
		 */
		private async getItems(): Promise<TreeItems.InnerItemType[]> {
			const isFileView = this.viewType === "File";
			const expandPrimaryGroup = ConfigMaid.get("view.defaultExpandPrimaryItems");
			const expandSecondaryGroup = ConfigMaid.get("view.defaultExpandSecondaryItems");

			const memos = MemoEngine.getMemos();
			this.memoCount = memos.length;
			if (memos.length === 0) return [];

			const tagColors = await MemoEngine.getTagColors();
			const inner = Aux.object.group(memos, isFileView ? "path" : "tag");
			const innerLabels = Object.keys(inner).sort();
			const innerItems = innerLabels.map(
				(label) => new (isFileView ? TreeItems.FileItem : TreeItems.TagItem)(label, expandPrimaryGroup),
			);

			await Aux.async.range(innerLabels.length, async (i) => {
				const innerLabel = innerLabels[i];
				const innerItem = innerItems[i];
				if (!isFileView) innerItem.iconPath = new ThemeIcon("bookmark", tagColors[innerLabel]);

				const halfLeaves = Aux.object.group(inner[innerLabel], isFileView ? "tag" : "path");
				const halfLeafLabels = Object.keys(halfLeaves).sort();
				const halfLeafItems: TreeItems.InnerItemType[] = isFileView
					? halfLeafLabels.map(
							(label) =>
								new TreeItems.TagItem(label, expandSecondaryGroup, <TreeItems.FileItem>innerItem),
					  )
					: halfLeafLabels.map(
							(label) =>
								new TreeItems.FileItem(label, expandSecondaryGroup, <TreeItems.TagItem>innerItem),
					  );
				innerItem.children = halfLeafItems;

				let childMemoCount = 0;
				await Aux.async.range(innerItem.children.length, async (j) => {
					const halfLeafItem = <TreeItems.InnerItemType>innerItem.children[j];
					const halfLeafLabel = halfLeafLabels[j];
					if (isFileView) halfLeafItem.iconPath = new ThemeIcon("bookmark", tagColors[halfLeafLabel]);

					let memos = <MemoEngine.Memo[]>halfLeaves[halfLeafLabel];
					const [important, normal]: MemoEngine.Memo[][] = [[], []];
					for (const memo of memos) {
						if (memo.priority !== 0) {
							important.push(memo);
							continue;
						}
						normal.push(memo);
					}
					memos = important.sort((a, b) => b.priority - a.priority).concat(normal);
					childMemoCount += memos.length;

					halfLeafItem.description = `${memos.length} Memo${Aux.string.plural(memos)}`;
					halfLeafItem.tooltip = new MarkdownString(
						`${isFileView ? "Tag: " : "File: *"}${halfLeafItem.label}${isFileView ? "" : "*"} - ${
							memos.length
						} $(pencil)`,
						true,
					);

					const tagColor = (<ThemeIcon>(isFileView ? halfLeafItem : innerItem).iconPath).color;
					const maxPriority = Math.max(...memos.map((memo) => memo.priority));
					const memoItems = await Aux.async.map(
						memos,
						async (memo) => new TreeItems.MemoItem(memo, tagColor, halfLeafItem, maxPriority),
					);
					halfLeafItem.children = memoItems;
				});

				innerItem.description = `${halfLeafItems.length} ${isFileView ? "Tag" : "File"}${Aux.string.plural(
					halfLeafItems,
				)} > ${childMemoCount} Memo${Aux.string.plural(childMemoCount)}`;
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
	const provider = new Provider();
	const explorer: TreeView<TreeItems.TreeItemType> = window.createTreeView("better-memo.memoExplorer", {
		treeDataProvider: provider,
		showCollapseAll: true,
		canSelectMany: false,
	});

	let updateSuppressed = false;
	let updateQueued = false;

	/**
	 * Inits Memo Explorer provider, view and event listeners
	 */
	export async function initExplorer(): Promise<void> {
		ConfigMaid.onChange("view.defaultView", updateViewType);
		ConfigMaid.onChange(["view.defaultExpandPrimaryItems", "view.defaultExpandSecondaryItems"], updateExpandState);

		Janitor.add(
			explorer,
			explorer.onDidChangeVisibility((ev) => {
				if (!ev.visible || !updateQueued) return;
				updateQueued = false;
				updateView();
			}),

			EventEmitter.subscribe("update", updateView),

			commands.registerCommand("better-memo.expandExplorer", () => {
				for (const item of provider.items) explorer.reveal(item, { select: false, expand: 2 });
			}),
			commands.registerCommand("better-memo.switchToFileView", () => updateViewType("File")),
			commands.registerCommand("better-memo.switchToTagView", () => updateViewType("Tag")),
			commands.registerCommand("better-memo.completeAllMemos", completeAllMemos),

			commands.registerCommand("better-memo.navigateToFile", (fileItem: TreeItems.FileItem) =>
				fileItem.navigateTo(),
			),
			commands.registerCommand("better-memo.completeFile", (fileItem: TreeItems.FileItem) =>
				fileItem.markMemosAsCompleted(),
			),
			commands.registerCommand("better-memo.completeFileNoConfirm", (fileItem: TreeItems.FileItem) =>
				fileItem.markMemosAsCompleted({ noConfirm: true }),
			),
			commands.registerCommand("better-memo.completeTag", (tagItem: TreeItems.TagItem) =>
				tagItem.markMemosAsCompleted(),
			),
			commands.registerCommand("better-memo.completeTagNoConfirm", (tagItem: TreeItems.TagItem) =>
				tagItem.markMemosAsCompleted({ noConfirm: true }),
			),
			commands.registerCommand("better-memo.navigateToMemo", (memoItem: TreeItems.MemoItem) =>
				memoItem.navigateTo(),
			),
			commands.registerCommand("better-memo.completeMemo", (memoItem: TreeItems.MemoItem) =>
				memoItem.markAsCompleted(),
			),
			commands.registerCommand("better-memo.confirmCompleteMemo", (memoItem: TreeItems.MemoItem) =>
				memoItem.markAsCompleted(),
			),
			commands.registerCommand("better-memo.completeMemoNoConfirm", (memoItem: TreeItems.MemoItem) =>
				memoItem.markAsCompleted({ noConfirm: true }),
			),
		);

		await provider.initProvider();
		commands.executeCommand("setContext", "better-memo.explorerInitFinished", true);
	}

	/**
	 * Reloads explorer with updated items from {@link MemoEngine},
	 * delays update if explorer is hidden or if update is suppressed
	 */
	export async function updateView(): Promise<void> {
		if (explorer.visible && !updateSuppressed) await provider.reloadItems();
		else updateQueued = true;
	}

	/**
	 * Updates provider items (does not reload items)
	 * @param item item to be updated, if not given the whole tree is refreshed
	 */
	export function refresh(item?: TreeItems.TreeItemType): void {
		provider.refresh(item);
	}

	/**
	 * Removes `items` from treeview
	 */
	export function removeItems(...items: TreeItems.InnerItemType[]): void {
		provider.removeItems(...items);
	}

	/**
	 * Suppresses view update (does not affect view refresh)
	 */
	export function suppressUpdate(): void {
		updateSuppressed = true;
	}

	/**
	 * Unsuppresses view update
	 */
	export function unsuppressUpdate(): void {
		updateSuppressed = false;
	}

	/**
	 * Updates view's view type (primary-secondary items hierarchy)
	 * @param viewType "File" - primary items is workspace documents; "Tag" - primary items is Memo tags
	 */
	function updateViewType(viewType: "File" | "Tag"): void {
		provider.viewType = viewType;
		commands.executeCommand("setContext", "better-memo.explorerView", viewType);
		updateView();
	}

	/**
	 * Updates primary & secondary item's expand/collapse state
	 */
	async function updateExpandState(expandPrimaryItems: boolean, expandSecondaryItems: boolean): Promise<void> {
		const afterReveal = async () => {
			await commands.executeCommand("list.collapseAll");
			if (expandSecondaryItems) {
				await Aux.async.map(
					provider.items.flatMap((item) => item.children),
					async (child) => await explorer.reveal(child, { select: false, expand: true }),
				);
			}
			for (const item of provider.items) {
				if (expandPrimaryItems) {
					explorer.reveal(item, { select: false, expand: true });
					continue;
				}
				await explorer.reveal(item, { select: false, focus: true });
				await commands.executeCommand("list.collapse");
			}
			await explorer.reveal(provider.items[0], {
				select: false,
				focus: true,
			});
		};

		try {
			await explorer.reveal(provider.items[0], { select: false, focus: true });
			await afterReveal();
		} finally {
		}
	}

	/**
	 * View action to mark all known Memos to be completed
	 */
	async function completeAllMemos(): Promise<void> {
		suppressUpdate();
		const memoCount = provider.memoCount;
		const items = provider.items;

		const completionDetail = `Are you sure you want to proceed?
			This will mark all ${memoCount} memo${Aux.string.plural(memoCount)} ${provider.viewType === "File" ? "in" : "under"} ${
			items.length
		} ${provider.viewType.toLowerCase()}${Aux.string.plural(items)} as completed.`;
		const option = await window.showInformationMessage(
			"Confirm Completion of Memos",
			{ modal: true, detail: completionDetail },
			"Yes",
		);
		if (!option) {
			unsuppressUpdate();
			return;
		}

		for (const item of items) await item.markMemosAsCompleted({ noConfirm: true, _noExtraTasks: true });
		MemoEngine.forgetAllMemos();
		provider.removeAllItems();
		refresh();
		unsuppressUpdate();
	}
}
