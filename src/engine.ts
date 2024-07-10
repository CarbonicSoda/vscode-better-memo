import * as vscode from "vscode";

export class MemoFetcher {
	public readonly MemoHeaderPattern = /(?:\/\/|#)mo +/i;
	public readonly MemoTagPattern = /(?<tag>\S+)/;
	public readonly MemoMatchPattern = new RegExp(
		`${this.MemoHeaderPattern.source}${this.MemoTagPattern.source}(?<content>.*)$`,
		"gmi",
	);

	public watchGlob: vscode.GlobPattern = "";
	public ignoreGlob: vscode.GlobPattern = "";

	public watchedDocuments: vscode.TextDocument[] = [];
	public documentToMemoMap: Map<vscode.TextDocument, MemoEntry[]> = new Map();
	public tags: Set<string> = new Set();

	private _workspaceConfig?: vscode.WorkspaceConfiguration;
	private _documentWatcher?: vscode.Disposable;

	private readonly FetchDocumentError = new Error("Error when fetching documents");

	public async startScanning() {
		this.stopScanning();
		this.documentToMemoMap.clear();

		this._fetchWorkspaceConfig();
		await this._fetchDocuments();
		this.watchedDocuments.forEach((document) => this._scanDocument(document));
		this._documentWatcher = vscode.workspace.onDidSaveTextDocument((document) => {
			if (this.watchedDocuments.includes(document)) {
				this._scanDocument(document);
			}
		});
	}
	public stopScanning() {
		this._documentWatcher?.dispose();
	}

	public getMemos() {
		return [...this.documentToMemoMap.values()].flat();
	}

	private _fetchWorkspaceConfig() {
		this._workspaceConfig = vscode.workspace.getConfiguration("better-memo");
		this.watchGlob = `{${this._workspaceConfig.get<string[]>("watch")!.join(",")}}`;
		this.ignoreGlob = `{${this._workspaceConfig.get<string[]>("ignore")!.join(",")}}`;
	}
	private async _fetchDocuments() {
		try {
			this.watchedDocuments = await Promise.all(
				await vscode.workspace
					.findFiles(this.watchGlob, this.ignoreGlob)
					.then((files) => files.map((file) => vscode.workspace.openTextDocument(file))),
			);
		} catch (err) {
			throw new FetcherError(this.FetchDocumentError, err);
		}
	}
	
	private _scanDocument(document: vscode.TextDocument) {
		const content = document.getText();
		let documentMemos = [];
		for (let match of content.matchAll(this.MemoMatchPattern)) {
			const [tag, content] = [match.groups!["tag"], match.groups!["content"]];
			this.tags.add(tag);
			documentMemos.push(
				new MemoEntry(content, tag, document, document.positionAt(match.index!).line),
			);
		}
		if (documentMemos.length !== 0) {
			this.documentToMemoMap.set(document, documentMemos);
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

	getHtmlListItem() {
		return `<li>${this.tag} $${this.content} - ${this.parent.fileName.match(/[^\/]+$/)![0]} Ln ${this.line}</li>`;
	}
}

export class memoExplorerViewProvider implements vscode.WebviewViewProvider {
	constructor(private readonly _extensionUri: vscode.Uri, private readonly _memoFetcher: MemoFetcher) {}

	private _view?: vscode.WebviewView;

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
		};

		webviewView.webview.html = this._getHtmlForWebview();

		webviewView.onDidChangeVisibility(() => {
			if (!webviewView.visible) {return;}

		});
		// webviewView.webview.onDidReceiveMessage(data => {
		// 	switch (data.type) {
		// 		case 'colorSelected':
		// 			{
		// 				vscode.window.activeTextEditor?.insertSnippet(new vscode.SnippetString(`#${data.value}`));
		// 				break;
		// 			}
		// 	}
		// });
	}

	private _getHtmlForWebview() {
		const memoList = `<ul>${this._memoFetcher.getMemos().map((memo) => memo.getHtmlListItem()).join("")}</ul>`;
		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Memo Explorer</title>
			</head>
			<body>
				${memoList}
			</body>
			</html>`;
	}
}

class FetcherError extends Error {
	constructor(baseError: Error, cause?: Error | string | unknown) {
		super(`BetterMemo $${baseError.message}`, { cause: cause!.toString() });
	}
}
