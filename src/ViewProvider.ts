import * as vscode from "vscode";
import * as EE from "./utils/EventEmitter";
import ConfigMaid from "./utils/ConfigMaid";
import MemoFetcher from "./MemoFetcher";

export default class MemoViewProvider implements vscode.WebviewViewProvider {
	constructor(private readonly _extensionUri: vscode.Uri, private readonly _memoFetcher: MemoFetcher) {}

	public defaultExplorerState: ExplorerState = {};

	private _view?: vscode.WebviewView;
	private _webview?: vscode.Webview;
	private _explorerState?: ExplorerState;

	private _disposables: (vscode.Disposable | EE.Disposable)[] = [];

	public async resolveWebviewView(
		view: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		token: vscode.CancellationToken,
	) {
		this._view = view;
		this._webview = view.webview;
		this._webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
		};
		this._webview.html = this._getHtmlTemplate();

		this._disposables.push(
			view.onDidChangeVisibility(() => {
				this._loadWebviewContent();
			}),
			EE.EventEmitter.subscribe("loadWebviewContent", () => {
				this._loadWebviewContent();
			}),
			EE.EventEmitter.subscribe("updateWebviewContent", () => {
				this._updateWebviewContent();
			}),
			this._webview.onDidReceiveMessage((m) => {
				switch (m.command) {
					case "updateState":
						this._explorerState = m.newState;
						break;
				}
			}),
		);
	}
	public dispose() {
		for (const disposable of this._disposables) disposable.dispose();
	}

	private _getHtmlTemplate() {
		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${
					this._webview.cspSource
				}; style-src ${this._webview.cspSource};"
				<title>Memo Explorer</title>
				<script defer src="${this._webview.asWebviewUri(
					vscode.Uri.joinPath(this._extensionUri, "media", "webview.js"),
				)}"></script>
			</head>
			<body>
				<p>anchor</p>
				<div id="explorer-root"></div>
			</body>
			</html>`;
	}
	private _loadWebviewContent() {
		if (!(this._webview && this._view?.visible)) return;
		this._webview.postMessage({
			command: "load",
			_memos: this._memoFetcher.memos,
			_state: this._explorerState,
		});
	}
	private _updateWebviewContent() {
		if (!(this._webview && this._view?.visible)) return;
		this._webview.postMessage({ command: "update", _changes: this._memoFetcher.getChanges() });
	}
}

type ExplorerState = {};
