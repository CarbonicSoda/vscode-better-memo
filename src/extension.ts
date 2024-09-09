import { disposeJanitor } from "./utils/janitor";
import { resolver as resolveConfigMaid } from "./utils/config-maid";
import { resolver as resolveIntervalMaid } from "./utils/interval-maid";
import { resolver as resolveTreeItems } from "./tree-items";
import { MemoEngine, getMemoEngine } from "./memo-engine";
import { TreeView, getTreeView } from "./tree-view";

let memoFetcher: MemoEngine;
let treeView: TreeView;

export async function activate(): Promise<void> {
	await resolveConfigMaid();
	await resolveIntervalMaid();
	await resolveTreeItems();

	memoFetcher = await getMemoEngine();
	await memoFetcher.init();

	treeView = await getTreeView();
	await treeView.init(memoFetcher);
}

export async function deactivate(): Promise<void> {
	await disposeJanitor();
}
