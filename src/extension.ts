import { disposeAllConfigMaids } from "./utils/config-maid";
import { resolver as ETItemsResolve } from "./explorer-tree-items";
import { resolver as ETViewResolve, ExplorerTreeView, getExplorerTreeView } from "./explorer-tree-view";
import { resolver as MemoFetcherResolve, MemoFetcher, getMemoFetcher } from "./memo-fetcher";

let memoFetcher: MemoFetcher;
let explorerTreeView: ExplorerTreeView;

export async function activate(): Promise<void> {
	await ETItemsResolve();
	await ETViewResolve();
	await MemoFetcherResolve();

	memoFetcher = await getMemoFetcher();
	await memoFetcher.init();

	explorerTreeView = await getExplorerTreeView();
	await explorerTreeView.init(memoFetcher);
}

export async function deactivate(): Promise<void> {
	explorerTreeView?.dispose();
	memoFetcher?.dispose();
	disposeAllConfigMaids();
}
