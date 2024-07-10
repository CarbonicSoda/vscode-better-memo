import * as vscode from "vscode";
import {MemoFetcher, memoExplorerViewProvider} from "./engine";

export function activate(context: vscode.ExtensionContext) {
	const engine = new MemoFetcher();
	engine.startScanning();
	const webviewViewProvider = new memoExplorerViewProvider(
		context.extensionUri,
	);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			"betterMemo.memoExplorer",
			webviewViewProvider,
		),
	);
}

export function deactivate() {}
