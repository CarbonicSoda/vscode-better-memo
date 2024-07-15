import * as vscode from "vscode";

export class MemoFetcher {
	public tags: Set<string> = new Set();

	private readonly _commentHeaders = ["//", "#", "<!--"];
	private readonly _headerPattern = `(?<head>${this._commentHeaders.join("|")})mo +`;
	private readonly _tagPattern = "(?<tag>S+)";
	private readonly _matchPattern = new RegExp(`${this._headerPattern}${this._tagPattern}(?<content>.*)$`, "gmi");

	private _workspaceConfig?: vscode.WorkspaceConfiguration;
	private _watchGlob: vscode.GlobPattern = "";
	private _ignoreGlob: vscode.GlobPattern = "";
	private _documentWatcher?: vscode.Disposable;
	private _watchedDocs: vscode.TextDocument[] = [];

	private _memoChanges: Map<vscode.TextDocument, MemoEntry[]> = new Map();

	public async init(viewProvider?: memoExplorerViewProvider) {
		this._fetchWorkspaceConfig();
		await this._fetchDocuments();
		this._watchedDocs.forEach((document) => this._scanDocument(document));
		this._documentWatcher = vscode.workspace.onDidSaveTextDocument((document) => {
			if (this._watchedDocs.includes(document)) {
				this._scanDocument(document);
				viewProvider?.updateView(this.getChanges());
			}
		});
	}
	public getChanges() {
		const changes = this._memoChanges;
		this._memoChanges.clear();
		return changes;
	}
	public stopScanning() {
		this._documentWatcher?.dispose();
	}

	private _fetchWorkspaceConfig() {
		this._workspaceConfig = vscode.workspace.getConfiguration("better-memo");
		this._watchGlob = `{${this._workspaceConfig.get<string[]>("watch")!.join(",")}}`;
		this._ignoreGlob = `{${this._workspaceConfig.get<string[]>("ignore")!.join(",")}}`;
	}
	private async _fetchDocuments() {
		try {
			this._watchedDocs = await Promise.all(
				await vscode.workspace
					.findFiles(this._watchGlob, this._ignoreGlob)
					.then((files) => files.map((file) => vscode.workspace.openTextDocument(file))),
			);
		} catch (err) {
			throw new Error(`Better Memo $Error when fetching documents: ${err}`);
		}
	}
	private _scanDocument(document: vscode.TextDocument) {
		const content = document.getText();
		let memos = [];
		for (const match of content.matchAll(this._matchPattern)) {
			const [head, tag, content] = [
				match.groups!["head"],
				match.groups!["tag"],
				match.groups!["content"].trimEnd(),
			];
			switch (head) {
				case "<!--":
					content.replace(/\s*-->$/, "");
					break;
			}
			this.tags.add(tag);
			memos.push(new MemoEntry(content, tag, document, document.positionAt(match.index!).line));
		}
		if (memos.length !== 0) {
			this._memoChanges.set(document, memos);
		}
	}
}

class MemoEntry {
	constructor(
		public content: string,
		public tag: string,
		public readonly parent: vscode.TextDocument,
		public readonly line: number,
	) {}
}

export class memoExplorerViewProvider implements vscode.WebviewViewProvider {
	constructor(private readonly _extensionUri: vscode.Uri, private readonly _memoFetcher: MemoFetcher) {}

	private _view?: vscode.WebviewView;

	public async resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
		};

		await this._memoFetcher.init(this);
		this._view.webview.html = this._getHtmlTemplate();
		webviewView.onDidChangeVisibility(() => {
			this.updateView(this._memoFetcher.getChanges());
		});
	}
	public updateView(changes: Map<vscode.TextDocument, MemoEntry[]>) {
		console.log(changes, "1"); //FIX changes is empty map?
		if (!(this._view && this._view.visible)) {
			return;
		}
		console.log("gonna update");
		this._view.webview.postMessage({ command: "update", changes: changes });
	}

	private _getHtmlTemplate() {
		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Memo Explorer</title>
			</head>
			<body>
				<div id="explorer-root"></div>
				<script src="${this._view?.webview.asWebviewUri(
					vscode.Uri.joinPath(this._extensionUri, "src", "webview.js"),
				)}"></script>
			</body>
			</html>`;
	}
}
