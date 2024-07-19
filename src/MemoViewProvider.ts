import * as vscode from "vscode";
import * as EE from "./utils/EventEmitter";
import Janitor from "./utils/Janitor";
import ConfigMaid from "./utils/ConfigMaid";
import { MemoFetcher, MemoEntry } from "./MemoFetcher";

export default class MemoViewProvider implements vscode.WebviewViewProvider {
	private _view?: vscode.WebviewView;
	private _webview?: vscode.Webview;
	private _janitor = new Janitor();

	constructor(private readonly _extensionUri: vscode.Uri, private readonly _memoFetcher: MemoFetcher) {
		this._janitor.add(
			EE.EventEmitter.subscribe("loadWebviewContent", (memos) => {
				this._loadWebviewContent(memos, true);
			}),
			EE.EventEmitter.subscribe("updateWebviewContent", (changes) => {
				this._updateWebviewContent(changes);
			}),
		);
	}

	public async resolveWebviewView(
		view: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		token: vscode.CancellationToken,
	) {
		vscode.window.showInformationMessage("Debug $Webview resolved");
		this._view = view;
		this._webview = view.webview;
		this._webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
		};
		this._webview.html = this._getHtmlTemplate();

		this._janitor.add(
			view.onDidChangeVisibility(() => {
				this._loadWebviewContent(this._memoFetcher.getMemos());
			}),
		);

		EE.EventEmitter.dispatch("viewResolved");
	}
	public dispose() {
		this._webview?.postMessage({ command: "dispose" });
		this._janitor.clearAll();
	}

	private _getHtmlTemplate() {
		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${
					this._webview.cspSource
				}; style-src ${this._webview.cspSource};">
				<title>Memo Explorer</title>
				<script defer src="${this._webview.asWebviewUri(
					vscode.Uri.joinPath(this._extensionUri, "media", "webview.js"),
				)}"></script>
			</head>
			<body>
				<div id="explorer-root"></div>
			</body>
			</html>`;
	}
	private async _loadWebviewContent(memos: MemoEntry[], preload?: boolean, defaultState?: ExplorerState) {
		if (!(this._view?.visible || preload)) return;
		if (preload) await EE.EventEmitter.wait("viewResolved");
		this._webview.postMessage({
			command: "load",
			_memos: memos,
			_state: defaultState,
		});
	}
	private _updateWebviewContent(changes: MemoEntry[]) {
		if (!this._view?.visible) return;
		this._webview.postMessage({ command: "update", _changes: changes });
	}
}

type ExplorerState = {};

//fix load and upd content
