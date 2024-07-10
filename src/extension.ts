import * as vscode from "vscode";
import {MemoFetcher, memoExplorerViewProvider} from "./engine";

export function activate(context: vscode.ExtensionContext) {
	const fetcher = new MemoFetcher();
	const webviewViewProvider = new memoExplorerViewProvider(
		context.extensionUri,
		fetcher
	);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			"betterMemo.memoExplorer",
			webviewViewProvider,
		),
	);
}

export function deactivate() {}
