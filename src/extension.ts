import { disposeAllConfigMaids } from "./utils/config-maid";
import { resolver as ETItemsResolve } from "./tree-items";
import { resolver as ETViewResolve, TreeView, getTreeView } from "./tree-view";
import { resolver as MemoFetcherResolve, MemoFetcher, getMemoFetcher } from "./memo-fetcher";

let memoFetcher: MemoFetcher;
let explorerTreeView: TreeView;

export async function activate(): Promise<void> {
	await ETItemsResolve();
	await ETViewResolve();
	await MemoFetcherResolve();

	memoFetcher = await getMemoFetcher();
	await memoFetcher.init();

	explorerTreeView = await getTreeView();
	await explorerTreeView.init(memoFetcher);
}

export async function deactivate(): Promise<void> {
	explorerTreeView?.dispose();
	memoFetcher?.dispose();
	disposeAllConfigMaids();
}
