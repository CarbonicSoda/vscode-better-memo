import { Aux } from "./utils/auxiliary";
import { MemoEngine, getMemoEngine } from "./memo-engine";
import { TreeView, getTreeView } from "./tree-view";
import { disposeJanitor } from "./utils/janitor";
import { resolver as resolveConfigMaid } from "./utils/config-maid";
import { resolver as resolveIntervalMaid } from "./utils/interval-maid";
import { resolver as resolveTreeItems } from "./tree-items";
import { resolver as resolveEditorCommands } from "./editor-commands";

let memoEngine: MemoEngine;
let treeView: TreeView;

export async function activate(): Promise<void> {
	await Aux.promise.all(resolveConfigMaid(), resolveIntervalMaid(), resolveTreeItems(), resolveEditorCommands());

	memoEngine = await getMemoEngine();
	treeView = await getTreeView();

	memoEngine.init();
	treeView.init(memoEngine);
}

export async function deactivate(): Promise<void> {
	await disposeJanitor();
}
