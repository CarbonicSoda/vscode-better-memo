import { disposeJanitor } from "./utils/janitor";
import { resolver as resolveConfigMaid } from "./utils/config-maid";
import { resolver as resolveIntervalMaid } from "./utils/interval-maid";
import { resolver as resolveTreeItems } from "./tree-items";
import { MemoEngine, getMemoEngine } from "./memo-engine";
import { TreeView, getTreeView } from "./tree-view";

let memoEngine: MemoEngine;
let treeView: TreeView;

export async function activate(): Promise<void> {
	await resolveConfigMaid();
	await resolveIntervalMaid();
	await resolveTreeItems();

	memoEngine = await getMemoEngine();
	treeView = await getTreeView();

	await memoEngine.init();
	await treeView.init(memoEngine);
}

export async function deactivate(): Promise<void> {
	await disposeJanitor();
}
