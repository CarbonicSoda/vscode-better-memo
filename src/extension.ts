import * as vscode from "vscode";
import { MemoFetcher } from "./memo-fetcher";
import { ExplorerTreeView } from "./explorer-view-provider";

let memoFetcher: MemoFetcher;
let explorerTreeView: ExplorerTreeView;
export function activate(context: vscode.ExtensionContext) {
	memoFetcher = new MemoFetcher();
	memoFetcher.init();
	explorerTreeView = new ExplorerTreeView();
	explorerTreeView.init(memoFetcher);
}

export function deactivate() {
	memoFetcher?.dispose();
	explorerTreeView?.dispose();
}
