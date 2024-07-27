import * as vscode from "vscode";
import { MemoFetcher } from "./memoFetcher";
import ExplorerViewProvider from "./explorerViewProvider";

let _memoFetcher: MemoFetcher;
let _explorerViewProvider: ExplorerViewProvider;
export function activate(context: vscode.ExtensionContext) {
	_memoFetcher = new MemoFetcher();
	_memoFetcher.init();
	_explorerViewProvider = new ExplorerViewProvider(_memoFetcher);
	vscode.window.createTreeView("better-memo.memoExplorer", {
		treeDataProvider: _explorerViewProvider,
		showCollapseAll: true,
	});
	vscode.commands.executeCommand("setContext", "better-memo.initFinished", true);
}

export function deactivate() {
	_memoFetcher?.dispose();
	_explorerViewProvider?.dispose();
}
