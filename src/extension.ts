import * as vscode from "vscode";
import { MemoFetcher, memoExplorerViewProvider } from "./engine";

let fetcher: MemoFetcher;
export function activate(context: vscode.ExtensionContext) {
	fetcher = new MemoFetcher();
	const webviewViewProvider = new memoExplorerViewProvider(context.extensionUri, fetcher);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider("betterMemo.memoExplorer", webviewViewProvider),
	);
}

export function deactivate() {
	fetcher?.dispose();
}
