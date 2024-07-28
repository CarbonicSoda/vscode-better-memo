import { ExplorerTreeView } from "./explorer-view-provider";
import { MemoFetcher } from "./memo-fetcher";

let memoFetcher: MemoFetcher;
let explorerTreeView: ExplorerTreeView;
export function activate() {
	memoFetcher = new MemoFetcher();
	memoFetcher.init();
	explorerTreeView = new ExplorerTreeView();
	explorerTreeView.init(memoFetcher);
}

export function deactivate() {
	memoFetcher?.dispose();
	explorerTreeView?.dispose();
}
