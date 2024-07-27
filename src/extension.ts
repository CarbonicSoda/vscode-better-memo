import * as vscode from "vscode";
import { MemoFetcher } from "./memoFetcher";
import ExplorerTreeView from "./explorerViewProvider";

let _memoFetcher: MemoFetcher;
let _explorerTreeView: ExplorerTreeView;
export function activate(context: vscode.ExtensionContext) {
	_memoFetcher = new MemoFetcher();
	_memoFetcher.init();
	_explorerTreeView = new ExplorerTreeView();
	_explorerTreeView.init(_memoFetcher);
}

export function deactivate() {
	_memoFetcher?.dispose();
	_explorerTreeView?.dispose();
}
