/**
 * Configs used in explorer-view.ts:
 * view.defaultView
 * view.defaultExpandPrimaryGroups, view.defaultExpandSecondaryGroups
 */

import {
	commands,
	MarkdownString,
	TextEditor,
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

		//#region Interface implementation methods

		getTreeItem(element: TreeItems.TreeItemType): TreeItems.TreeItemType {
			return element;
		}

		getParent(element: TreeItems.TreeItemType): TreeItems.InnerItemType | undefined {
			return element.parent;
		}

		getChildren(element: TreeItems.InnerItemType | undefined): TreeItems.TreeItemType[] {
			if (element) return element.children;
			return this.items;
		}

		//#endregion End of interface implementation methods

		/**
		 * @returns all MemoItems in Memo Explorer
		 */
		getMemoItems(): TreeItems.MemoItem[] {
			return <TreeItems.MemoItem[]>(
				this.items
					.flatMap((primary) => primary.children)
					.flatMap((secondary) => (<TreeItems.InnerItemType>secondary).children)
			);
		}

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
			const expandPrimaryGroup = ConfigMaid.get("view.defaultExpandPrimaryGroups");
			const expandSecondaryGroup = ConfigMaid.get("view.defaultExpandSecondaryGroups");

			const memos = MemoEngine.getMemos();
			this.memoCount = memos.length;
			if (memos.length === 0) return [];

			const tagColors = await MemoEngine.getTagColors();
			const inner = Aux.object.group(memos, isFileView ? "fileName" : "tag");
			const innerLabels = Object.keys(inner).sort();
			const innerItems = innerLabels.map(
				(label) => new (isFileView ? TreeItems.FileItem : TreeItems.TagItem)(label, expandPrimaryGroup),
			);

			for (let i = 0; i < innerLabels.length; i++) {
				const innerLabel = innerLabels[i];
				const innerItem = innerItems[i];
				if (!isFileView) innerItem.iconPath = new ThemeIcon("bookmark", tagColors[innerLabel]);

				const halfLeaves = Aux.object.group(inner[innerLabel], isFileView ? "tag" : "fileName");
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
				for (let j = 0; j < innerItem.children.length; j++) {
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
					const memoItems = memos.map(
						(memo) => new TreeItems.MemoItem(memo, tagColor, halfLeafItem, maxPriority),
					);
					halfLeafItem.children = memoItems;
				}

				innerItem.description = `${halfLeafItems.length} ${isFileView ? "Tag" : "File"}${Aux.string.plural(
					halfLeafItems,
				)} > ${childMemoCount} Memo${Aux.string.plural(childMemoCount)}`;
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
	const provider = new Provider();
	const explorer: TreeView<TreeItems.TreeItemType> = window.createTreeView("better-memo.memoExplorer", {
		treeDataProvider: provider,
		canSelectMany: false,
	});

	let updateSuppressed = false;
	let foldState: 0 | 1 | 2 = <0 | 1 | 2>(
		(Number(ConfigMaid.get("view.defaultExpandPrimaryGroups")) +
			Number(
				ConfigMaid.get("view.defaultExpandPrimaryGroups") &&
					ConfigMaid.get("view.defaultExpandSecondaryGroups"),
			))
	);

	/**
	 * Inits Memo Explorer provider, view and event listeners
	 */
	export async function initExplorerView(): Promise<void> {
		ConfigMaid.onChange("view.defaultView", updateViewType);
		ConfigMaid.onChange(
			["view.defaultExpandPrimaryGroups", "view.defaultExpandSecondaryGroups"],
			(primary, secondary) => {
				updateExpandState(primary, secondary);
				foldState = Number(primary) + Number(primary && secondary);
			},
		);

		Janitor.add(
			explorer,

			EventEmitter.subscribe("update", updateView),

			window.onDidChangeTextEditorSelection((ev) => onChangeEditorSelection(ev.textEditor)),

			commands.registerCommand("better-memo.toggleExplorerFold", toggleExplorerFold),
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

		const editor = window.activeTextEditor;
		if (editor?.selection) onChangeEditorSelection(editor);
	}

	/**
	 * Reloads explorer with updated items from {@link MemoEngine},
	 * delays update if explorer is hidden or if update is suppressed
	 */
	export async function updateView(): Promise<void> {
		if (!updateSuppressed) await provider.reloadItems();
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
	async function updateViewType(viewType: "File" | "Tag"): Promise<void> {
		provider.viewType = viewType;
		await commands.executeCommand("setContext", "better-memo.explorerView", viewType);
		await updateView();

		const level1 = ConfigMaid.get("view.defaultExpandPrimaryGroups");
		const level2 = ConfigMaid.get("view.defaultExpandSecondaryGroups");
		foldState = Number(level1) + Number(level1 && level2);
		await updateExpandState(level1, level2);
	}

	/**
	 * Updates primary & secondary item's expand/collapse state
	 */
	async function updateExpandState(level1: boolean, level2: boolean): Promise<void> {
		try {
			await explorer.reveal(provider.items[0], { focus: true });
			await commands.executeCommand("list.collapseAll");
			for (const item of provider.items) {
				await explorer.reveal(item, { focus: true, select: false, expand: level2 ? 2 : false });
				await commands.executeCommand(level1 ? "list.expand" : "list.collapse");
			}
			await explorer.reveal(provider.items[0], { focus: true });
		} catch {}
	}

	/**
	 * Toggles explorer fold status: Layer1, Layer2, Collapsed
	 */
	async function toggleExplorerFold(): Promise<void> {
		foldState = (foldState + 1) % 3;
		await updateExpandState(foldState > 0, foldState > 1);
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

	/**
	 * Selects the MemoItem right before editor selection in Memo Explorer
	 */
	function onChangeEditorSelection(editor: TextEditor): void {
		if (!explorer.visible) return;

		const doc = editor.document;
		if (!MemoEngine.isDocWatched(doc)) return;

		const memoItems = provider.getMemoItems();
		const docMemoItems = memoItems.filter((memoItem) => memoItem.memo.fileName === doc.fileName);
		if (docMemoItems.length === 0) return;

		let offset = doc.offsetAt(editor.selection.active);
		if (MemoEngine.getMemoTemplate(doc.languageId).tail) offset--;
		let i = Aux.algorithm.predecessorSearch(
			docMemoItems.sort((m1, m2) => m1.memo.offset - m2.memo.offset),
			offset,
			(memoItem) => memoItem.memo.offset,
		);
		if (i === -1) i = 0;
		explorer.reveal(docMemoItems[i]);
	}
}
