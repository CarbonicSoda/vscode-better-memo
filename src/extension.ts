import * as vscode from "vscode";
import { ExplorerTreeView } from "./explorer-view-provider";
import { MemoFetcher } from "./memo-fetcher";

let memoFetcher: MemoFetcher;
let explorerTreeView: ExplorerTreeView;
export function activate() {
	vscode.commands.executeCommand("workbench.action.toggleAutoSave");
	memoFetcher = new MemoFetcher();
	memoFetcher.init();
	explorerTreeView = new ExplorerTreeView();
	explorerTreeView.init(memoFetcher);
}

export function deactivate() {
	memoFetcher?.dispose();
	explorerTreeView?.dispose();
	vscode.commands.executeCommand("workbench.action.toggleAutoSave");
}
