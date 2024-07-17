import * as vscode from "vscode";
import * as EV from "./utils/EventEmitter";
import MemoFetcher from "./MemoFetcher";

let _fetcher: MemoFetcher;
export function activate(context: vscode.ExtensionContext) {
	_fetcher = new MemoFetcher();
	EV.EventEmitter.subscribe("loadWebviewContent", (content) => {
		console.log("loaded:", content);
	});
	EV.EventEmitter.subscribe("updateWebviewContent", (changes) => {
		console.log("changed:", changes);
	});
	_fetcher.init();

	// const webviewViewProvider = new memoExplorerViewProvider(context.extensionUri, fetcher);
	// context.subscriptions.push(
	// 	// vscode.window.registerWebviewViewProvider("better-memo.memoExplorer", webviewViewProvider),
	// );
}

export function deactivate() {
	_fetcher?.dispose();
}
