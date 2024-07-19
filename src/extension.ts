import * as vscode from "vscode";
import { MemoFetcher } from "./MemoFetcher";
import MemoViewProvider from "./MemoViewProvider";

let _memoFetcher = new MemoFetcher();
export async function activate(context: vscode.ExtensionContext) {
	_memoFetcher.init();
	const webviewViewProvider = new MemoViewProvider(context.extensionUri, _memoFetcher);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider("better-memo.memoExplorer", webviewViewProvider),
	);
}

export function deactivate() {
	_memoFetcher?.dispose();
}
