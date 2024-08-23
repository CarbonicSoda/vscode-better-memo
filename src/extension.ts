import * as vscode from "vscode";

import { ExplorerTreeView } from "./explorer-view-provider";
import { MemoFetcher } from "./memo-fetcher";

let memoFetcher: MemoFetcher;
let explorerTreeView: ExplorerTreeView;

export function activate(): void {
	memoFetcher = new MemoFetcher();
	memoFetcher.init();
	explorerTreeView = new ExplorerTreeView();
	explorerTreeView.init(memoFetcher);
}

export function deactivate(): void {
	memoFetcher?.dispose();
	explorerTreeView?.dispose();
}
