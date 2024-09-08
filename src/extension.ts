import { disposeJanitor } from "./utils/janitor";
import { resolver as resolveConfigMaid } from "./utils/config-maid";
import { resolver as resolveIntervalMaid } from "./utils/interval-maid";
import { resolver as resolveTreeItems } from "./tree-items";
import { MemoFetcher, getMemoFetcher } from "./memo-fetcher";
import { TreeView, getTreeView } from "./tree-view";

let memoFetcher: MemoFetcher;
let treeView: TreeView;

export async function activate(): Promise<void> {
	await resolveConfigMaid();
	await resolveIntervalMaid();
	await resolveTreeItems();

	memoFetcher = await getMemoFetcher();
	await memoFetcher.init();

	treeView = await getTreeView();
	await treeView.init(memoFetcher);
}

export async function deactivate(): Promise<void> {
	await disposeJanitor();
}
