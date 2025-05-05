import { commands, TreeItemCollapsibleState, window } from "vscode";

import { Doc } from "../engine/doc";
import { Format } from "../engine/format";
import { Memo } from "../engine/memo";
import { Scan } from "../engine/scan";
import { Aux } from "../utils/auxiliary";
import { Config } from "../utils/config";
import { EventEmitter } from "../utils/event-emitter";
import { FileEdit } from "../utils/file-edit";
import { Janitor } from "../utils/janitor";
import { TreeItem } from "./tree-item";
import { TreeProvider } from "./tree-provider";

export function initTree() {
	const provider = new TreeProvider();

	const explorer = window.createTreeView("better-memo.memoExplorer", {
		treeDataProvider: provider,
		canSelectMany: false,
	});

	const expand = { primary: true, secondary: true };

	function updateView(): void {
		provider.refresh(expand);
	}

	Config.onChange("defaultView", (view: "tag" | "file") => {
		provider.view = view;
		updateView();
	});

	async function completeItem(
		item: TreeItem.TagItem<"primary"> | TreeItem.FileItem<"primary">,
		options?: {
			noConfirm?: boolean;
		},
	): Promise<void> {
		const { docs } = await (await item.complete(undefined, options)).apply();
		if (docs.length === 0) return;

		await Scan.docs(docs, { flush: true });
		updateView();
	}

	Janitor.add(
		explorer,

		EventEmitter.subscribe("Update", updateView),

		commands.registerCommand("better-memo.toggleFold", () => {
			[expand.primary, expand.secondary] = [
				!expand.secondary,
				expand.primary && !expand.secondary,
			];

			for (const item of provider.items) {
				item.collapsibleState = expand.primary
					? TreeItemCollapsibleState.Expanded
					: TreeItemCollapsibleState.Collapsed;

				if (item.label.endsWith("\u200b")) {
					item.label = item.label.slice(0, -1);
				} else {
					item.label = item.label + "\u200b";
				}

				for (const child of item.children) {
					child.collapsibleState = expand.secondary
						? TreeItemCollapsibleState.Expanded
						: TreeItemCollapsibleState.Collapsed;
				}
			}
			provider.flush();
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

		commands.registerCommand("better-memo.completeTag", completeItem),
		commands.registerCommand(
			"better-memo.completeTagNoConfirm",
			async (tagItem: TreeItem.TagItem<"primary">) => {
				completeItem(tagItem, { noConfirm: true });
			},
		),

		commands.registerCommand("better-memo.completeFile", completeItem),
		commands.registerCommand(
			"better-memo.completeFileNoConfirm",
			async (fileItem: TreeItem.FileItem<"primary">) => {
				completeItem(fileItem, { noConfirm: true });
			},
		),

		commands.registerCommand("better-memo.completeAllMemos", async () => {
			const items = provider.items;
			const memos = Memo.data.memos;

			const completionDetail = `Are you sure you want to proceed?
					This will mark all ${memos.length} memo${Aux.string.plural(memos)} ${
				provider.view === "tag" ? "of" : "in"
			} ${items.length} ${provider.view}${Aux.string.plural(
				items,
			)} as completed.`;

			const confirm = await window.showInformationMessage(
				"Confirm Completion of Memos",
				{ modal: true, detail: completionDetail },
				"Yes",
			);
			if (!confirm) return;

			const edit = new FileEdit.Edit();
			for (const item of items) await item.complete(edit, { noConfirm: true });
			await edit.apply();

			await Scan.docs(edit.docs, { flush: true });
			updateView();
		}),

		commands.registerCommand(
			"better-memo.navigateToMemo",
			(navigate: () => void) => navigate(),
		),

		commands.registerCommand(
			"better-memo.completeMemo",
			async (memoItem: TreeItem.MemoItem<"tag" | "file">) => {
				await memoItem.complete().apply();

				await Scan.doc(memoItem.memo.meta.doc, { flush: true });
				updateView();
			},
		),

		window.onDidChangeTextEditorSelection((ev) => {
			if (!explorer.visible) return;

			const editor = ev.textEditor;
			const doc = editor.document;
			if (!Doc.includes(doc)) return;

			const memos = provider.memos.filter((item) => item.memo.meta.doc === doc);
			if (memos.length === 0) return;

			memos.sort((itemA, itemB) =>
				itemA.memo.meta.start.compareTo(itemB.memo.meta.start),
			);

			let active = editor.selection.active;
			if (!active) return;
			if (Format.getTemplate(doc.languageId).tail) {
				active = active.translate(0, -1);
			}

			let i = Aux.algorithm.predecessorSearch(
				active,
				memos,
				(item) => item.memo.meta.start,
				(a, b) => a.compareTo(b),
			);
			if (i === undefined) return;
			if (i === -1) i = 0;

			explorer.reveal(memos[i]);
		}),
	);

	updateView();
	commands.executeCommand("setContext", "better-memo.init", true);
}
