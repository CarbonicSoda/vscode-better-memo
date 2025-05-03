import { commands, TreeItemCollapsibleState, window } from "vscode";

import { TreeProvider } from "./tree-provider";
import { Config } from "../utils/config";
import { Janitor } from "../utils/janitor";
import { EventEmitter } from "../utils/event-emitter";
import { TreeItem } from "./tree-item";
import { Memo } from "../engine/memo";
import { Scan } from "../engine/scan";

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

	async function completeTag(
		tagItem: TreeItem.TagItem<"primary">,
		options?: { noConfirm?: boolean },
	): Promise<void> {
		const memos = await tagItem.complete(options);
		if (memos.length === 0) return;

		const docs = Array.from(new Set(memos.map((memo) => memo.meta.doc)));
		for (const doc of docs) Scan.doc(doc);

		updateView();
	}

	async function completeFile(
		fileItem: TreeItem.FileItem<"primary">,
		options?: { noConfirm?: boolean },
	): Promise<void> {
		const memos = await fileItem.complete(options);
		if (memos.length === 0) return;

		Scan.doc(memos[0].meta.doc);

		updateView();
	}

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

		commands.registerCommand(
			"better-memo.navigateToFile",
			(fileItem: TreeItem.FileItem<"primary" | "secondary">) => {
				fileItem.navigate();
			},
		),

		commands.registerCommand(
			"better-memo.completeTag",
			(tagItem: TreeItem.TagItem<"primary">) => completeTag(tagItem),
		),
		commands.registerCommand(
			"better-memo.completeTagNoConfirm",
			(tagItem: TreeItem.TagItem<"primary">) => {
				completeTag(tagItem, { noConfirm: true });
			},
		),

		commands.registerCommand(
			"better-memo.completeFile",
			(fileItem: TreeItem.FileItem<"primary">) => completeFile(fileItem),
		),
		commands.registerCommand(
			"better-memo.completeFileNoConfirm",
			(fileItem: TreeItem.FileItem<"primary">) => {
				completeFile(fileItem, { noConfirm: true });
			},
		),

		commands.registerCommand("better-memo.completeAllMemos", () => {
			// const memoCount = Memo.data.memos.length;
			// const primaryItems = provider.items;
			// const completionDetail = `Are you sure you want to proceed?
			// 		This will mark all ${memoCount} memo${Aux.string.plural(memoCount)} ${
			// 	provider.viewType === "File" ? "in" : "under"
			// } ${
			// 	primaryItems.length
			// } ${provider.viewType.toLowerCase()}${Aux.string.plural(
			// 	primaryItems,
			// )} as completed.`;
			// const option = await window.showInformationMessage(
			// 	"Confirm Completion of Memos",
			// 	{ modal: true, detail: completionDetail },
			// 	"Yes",
			// );
			// if (!option) {
			// 	unsuppressUpdate();
			// 	return;
			// }
			// for (const item of primaryItems) {
			// 	await item.markMemosAsCompleted({
			// 		noConfirm: true,
			// 		_noExtraTasks: true,
			// 	});
			// }
			// // MemoEngine.forgetAllMemos();
			// provider.removeAllItems();
			// refresh();
		}),

		commands.registerCommand(
			"better-memo.navigateToMemo",
			(navigate: () => void) => navigate(),
		),

		commands.registerCommand(
			"better-memo.completeMemo",
			(memoItem: TreeItem.MemoItem<"tag" | "file">) => {
				memoItem.complete();
			},
		),
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

// 	// /**
// 	//  * View action to mark all known Memos to be completed
// 	//  */
// 	// async function completeAllMemos(): Promise<void> {
// 	// 	suppressUpdate();
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
