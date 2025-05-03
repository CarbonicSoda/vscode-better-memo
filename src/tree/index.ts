import { commands, TreeItemCollapsibleState, window } from "vscode";

import { TreeProvider } from "./tree-provider";
import { Config } from "../utils/config";
import { Janitor } from "../utils/janitor";
import { EventEmitter } from "../utils/event-emitter";
import { TreeItem } from "./tree-item";

export function initTree() {
	const provider = new TreeProvider();

	const explorer = window.createTreeView("better-memo.memoExplorer", {
		treeDataProvider: provider,
		canSelectMany: false,
	});

	const expand = { primary: true, secondary: true };

	function updateFold(newExpand: typeof expand): void {
		for (const item of provider.items) {
			item.collapsibleState = newExpand.primary
				? TreeItemCollapsibleState.Expanded
				: TreeItemCollapsibleState.Collapsed;

			if (item.label.endsWith("\u200b")) {
				item.label = item.label.slice(0, -1);
			} else {
				item.label = item.label + "\u200b";
			}

			for (const child of item.children) {
				child.collapsibleState = newExpand.secondary
					? TreeItemCollapsibleState.Expanded
					: TreeItemCollapsibleState.Collapsed;
			}
		}
		provider.flush();

		expand.primary = newExpand.primary;
		expand.secondary = newExpand.secondary;
	}

	function updateView(): void {
		provider.refresh(expand);
	}

	Config.onChange("view.defaultView", (view: "tag" | "file") => {
		provider.view = view;
		updateView();
	});

	Janitor.add(
		explorer,

		EventEmitter.subscribe("UpdateView", updateView),

		// window.onDidChangeTextEditorSelection((ev) =>
		// 	onChangeEditorSelection(ev.textEditor),
		// ),

		commands.registerCommand("better-memo.toggleExplorerFold", () => {
			updateFold({
				primary: !expand.primary || !expand.secondary,
				secondary: expand.primary && !expand.secondary,
			});
		}),

		commands.registerCommand("better-memo.switchToTagView", () => {
			provider.view = "tag";
			updateView();
		}),
		commands.registerCommand("better-memo.switchToFileView", () => {
			provider.view = "file";
			updateView();
		}),
		// commands.registerCommand(
		// 	"better-memo.completeAllMemos",
		// 	completeAllMemos,
		// ),

		commands.registerCommand(
			"better-memo.navigateToFile",
			(fileItem: TreeItem.FileItem<"primary" | "secondary">) => {
				fileItem.navigate();
			},
		),
		// commands.registerCommand(
		// 	"better-memo.completeFile",
		// 	(fileItem: TreeItems.FileItem) => fileItem.markMemosAsCompleted(),
		// ),
		// commands.registerCommand(
		// 	"better-memo.completeFileNoConfirm",
		// 	(fileItem: TreeItems.FileItem) =>
		// 		fileItem.markMemosAsCompleted({ noConfirm: true }),
		// ),
		// commands.registerCommand(
		// 	"better-memo.completeTag",
		// 	(tagItem: TreeItems.TagItem) => tagItem.markMemosAsCompleted(),
		// ),
		// commands.registerCommand(
		// 	"better-memo.completeTagNoConfirm",
		// 	(tagItem: TreeItems.TagItem) =>
		// 		tagItem.markMemosAsCompleted({ noConfirm: true }),
		// ),
		// 	commands.registerCommand(
		// 		"better-memo.navigateToMemo",
		// 		(memoItem: TreeItem.MemoItem) => memoItem.navigateTo(),
		// 	),
		// 	commands.registerCommand(
		// 		"better-memo.completeMemo",
		// 		(memoItem: TreeItem.MemoItem) => memoItem.markAsCompleted(),
		// 	),
		// 	commands.registerCommand(
		// 		"better-memo.confirmCompleteMemo",
		// 		(memoItem: TreeItem.MemoItem) => memoItem.markAsCompleted(),
		// 	),
		// 	commands.registerCommand(
		// 		"better-memo.completeMemoNoConfirm",
		// 		(memoItem: TreeItem.MemoItem) =>
		// 			memoItem.markAsCompleted({ noConfirm: true }),
		// 	),
	);

	updateView();
	commands.executeCommand("setContext", "better-memo.init", true);
}

// 	/**
// 	 * Inits Memo Explorer provider, view and event listeners
// 	 */
// 	export function init(): void {

// 		provider.reloadItems();

// 		// const editor = window.activeTextEditor;
// 		// if (editor?.selection) onChangeEditorSelection(editor);
// 	}

// 	/**
// 	 * Reloads explorer with updated items from {@link Engine},
// 	 * delays update if explorer is hidden or if update is suppressed
// 	 */
// 	export function updateView(): void {
// 		if (!updateSuppressed) provider.reloadItems();
// 	}

// 	/**
// 	 * Updates provider items (does not reload items)
// 	 * @param item item to be updated, if not given the whole tree is refreshed
// 	 */
// 	export function refresh(item?: TreeItem.ItemType): void {
// 		provider.refresh(item);
// 	}

// 	/**
// 	 * Removes `items` from treeview
// 	 */
// 	export function removeItems(...items: TreeItem.InnerItemType[]): void {
// 		provider.removeItems(...items);
// 	}

// 	/**
// 	 * Suppresses view update (does not affect view refresh)
// 	 */
// 	export function suppressUpdate(): void {
// 		updateSuppressed = true;
// 	}

// 	/**
// 	 * Unsuppresses view update
// 	 */
// 	export function unsuppressUpdate(): void {
// 		updateSuppressed = false;
// 	}

// 	/**
// 	 * Updates view's view type (primary-secondary items hierarchy)
// 	 * @param viewType "File" - primary items is workspace documents; "Tag" - primary items is Memo tags
// 	 */
// 	async function updateViewType(viewType: "File" | "Tag"): Promise<void> {
// 		provider.viewType = viewType;
// 		await commands.executeCommand(
// 			"setContext",
// 			"better-memo.explorerView",
// 			viewType,
// 		);
// 		updateView();

// 		const level1 = Config.get("view.defaultExpandPrimaryGroups");
// 		const level2 = Config.get("view.defaultExpandSecondaryGroups");
// 		foldState = Number(level1) + Number(level1 && level2);
// 		await updateExpandState(level1, level2);
// 	}

// 	/**
// 	 * Updates primary & secondary item's expand/collapse state
// 	 */
// 	function updateExpandState(level1: boolean, level2: boolean): void {
//
// 	}

// 	/**
// 	 * Toggles explorer fold status: Layer1, Layer2, Collapsed
// 	 */
// 	async function toggleExplorerFold(): Promise<void> {
// 		foldState = (foldState + 1) % 3;
// 		await updateExpandState(foldState > 0, foldState > 1);
// 	}

// 	// /**
// 	//  * View action to mark all known Memos to be completed
// 	//  */
// 	// async function completeAllMemos(): Promise<void> {
// 	// 	suppressUpdate();
// 	// 	const memoCount = provider.memoCount;
// 	// 	const items = provider.items;

// 	// 	const completionDetail = `Are you sure you want to proceed?
// 	// 		This will mark all ${memoCount} memo${Aux.string.plural(memoCount)} ${
// 	// 		provider.viewType === "File" ? "in" : "under"
// 	// 	} ${items.length} ${provider.viewType.toLowerCase()}${Aux.string.plural(
// 	// 		items,
// 	// 	)} as completed.`;
// 	// 	const option = await window.showInformationMessage(
// 	// 		"Confirm Completion of Memos",
// 	// 		{ modal: true, detail: completionDetail },
// 	// 		"Yes",
// 	// 	);
// 	// 	if (!option) {
// 	// 		unsuppressUpdate();
// 	// 		return;
// 	// 	}

// 	// 	for (const item of items) {
// 	// 		await item.markMemosAsCompleted({ noConfirm: true, _noExtraTasks: true });
// 	// 	}
// 	// 	// MemoEngine.forgetAllMemos();
// 	// 	provider.removeAllItems();
// 	// 	refresh();
// 	// 	unsuppressUpdate();
// 	// }

// 	// /**
// 	//  * Selects the MemoItem right before editor selection in Memo Explorer
// 	//  */
// 	// function onChangeEditorSelection(editor: TextEditor): void {
// 	// 	if (!explorer.visible) return;

// 	// 	const doc = editor.document;
// 	// 	if (!MemoEngine.isDocWatched(doc)) return;

// 	// 	const memoItems = provider.getMemoItems();
// 	// 	const docMemoItems = memoItems.filter(
// 	// 		(memoItem) => memoItem.memo.fileName === doc.fileName,
// 	// 	);
// 	// 	if (docMemoItems.length === 0) return;

// 	// 	let offset = doc.offsetAt(editor.selection.active);
// 	// 	if (MemoEngine.getTemplate(doc.languageId).tail) offset--;
// 	// 	let i = Aux.algorithm.predecessorSearch(
// 	// 		docMemoItems.sort((m1, m2) => m1.memo.offset - m2.memo.offset),
// 	// 		offset,
// 	// 		(memoItem) => memoItem.memo.offset,
// 	// 	);
// 	// 	if (i === -1) i = 0;
// 	// 	explorer.reveal(docMemoItems[i]);
// 	// }
// }
