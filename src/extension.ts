import * as vscode from "vscode";
import { MemoFetcher } from "./MemoFetcher";
import MemoViewProvider from "./MemoViewProvider";
import { EventEmitter } from "./utils/EventEmitter";

let _memoFetcher = new MemoFetcher();
export function activate(context: vscode.ExtensionContext) {
	const webviewViewProvider = new MemoViewProvider(context.extensionUri, _memoFetcher);
	_memoFetcher.init();
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider("better-memo.memoExplorer", webviewViewProvider),
	);
}

export function deactivate() {
	_memoFetcher?.dispose();
}
