import { disposeConfigMaidInstances } from "./utils/config-maid";
import { resolver as ETItemsResolve } from "./explorer-tree-items";
import { resolver as ETViewResolve , ExplorerTreeView } from "./explorer-tree-view";
import { resolver as MemoFetcherResolve, MemoFetcher } from "./memo-fetcher";

let memoFetcher: MemoFetcher;
let explorerTreeView: ExplorerTreeView;

export async function activate(): Promise<void> {
	await ETItemsResolve();
	await ETViewResolve();
	await MemoFetcherResolve();

	memoFetcher = new MemoFetcher();
	await memoFetcher.init();

	explorerTreeView = new ExplorerTreeView();
	await explorerTreeView.init(memoFetcher);
}

export async function deactivate(): Promise<void> {
	await explorerTreeView?.dispose();
	await memoFetcher?.dispose();
	await disposeConfigMaidInstances();
}
