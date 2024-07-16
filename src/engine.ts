import * as vscode from "vscode";

export class MemoFetcher {
	public tags: Set<string> = new Set();

	private readonly _commentHeaders = ["//", "#", "/*", "<!--"];
	private readonly _commentTrails: { [header: string]: string } = {
		"/*": "*/",
		"<!--": "-->",
	};
	private readonly _headerPattern = `(?<head>${this._commentHeaders.join("|")})\\s?mo\\s+`;
	private readonly _matchPattern = new RegExp(`${this._headerPattern}(?<tag>\\S+)\\s+(?<content>.*)$`, "gmi");

	private _workspaceConfig: vscode.WorkspaceConfiguration;
	private _watchGlob: vscode.GlobPattern;
	private _ignoreGlob: vscode.GlobPattern;
	private _scanDelay: number;

	private _events: vscode.Disposable[] = [];
	private _intervals: NodeJS.Timeout[] = [];
	private _watchedDocs: vscode.TextDocument[] = [];
	private _viewProvider: memoExplorerViewProvider;
	private _memoChanges: Map<vscode.TextDocument, MemoEntry[]> = new Map();

	public async init(viewProvider: memoExplorerViewProvider) {
		this._viewProvider = viewProvider;

		this._fetchConfigs();
		this._events.push(
			vscode.workspace.onDidChangeConfiguration((ev) => {
				if (!ev.affectsConfiguration("better-memo")) return;
				this._fetchConfigs();
			}),
		);

		await this._fetchDocs();
		this._events.push(
			vscode.workspace.onDidCreateFiles(() => {
				this._fetchDocs();
			}),
		);
		this._events.push(
			vscode.workspace.onDidDeleteFiles((ev) => {
				this._watchedDocs = this._watchedDocs.filter((doc) => !ev.files.includes(doc.uri));
			}),
		);

		this._events.push(
			vscode.workspace.onDidSaveTextDocument((doc) => {
				if (this._watchedDocs.includes(doc)) this._scanDoc(doc, true);
			}),
		);
		this._intervals.push(
			setInterval(() => {
				const doc = vscode.window.activeTextEditor.document;
				if (!(this._watchedDocs.includes(doc) && doc.isDirty)) return;
				this._scanDoc(doc, true);
			}, this._scanDelay),
		);

		this._watchedDocs.forEach((doc) => this._scanDoc(doc));
		viewProvider.updateView(this.getChanges());
	}
	public getChanges() {
		const changes = JSON.stringify([...this._memoChanges.values()].flat());
		this._memoChanges.clear();
		return changes;
	}
	public dispose() {
		for (const event of this._events) event.dispose();
		for (const interval of this._intervals) clearInterval(interval);
	}

	private _fetchConfigs() {
		this._workspaceConfig = vscode.workspace.getConfiguration("better-memo");
		this._watchGlob = `{${this._workspaceConfig.get<string[]>("watch").join(",")}}`;
		this._ignoreGlob = `{${this._workspaceConfig.get<string[]>("ignore").join(",")}}`;
		this._scanDelay = this._workspaceConfig.get("scanDelay");
	}
	private async _fetchDocs() {
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
	private _scanDoc(doc: vscode.TextDocument, updateWebview?: boolean) {
		const content = doc.getText();
		let memos = [];
		for (const match of content.matchAll(this._matchPattern)) {
			const [head, tag] = [match.groups["head"], match.groups["tag"]];
			const content = match.groups["content"].replace(
				new RegExp(`\s*${this._commentTrails[head] ?? ""}$`),
				"",
			);
			this.tags.add(tag);
			memos.push(new MemoEntry(content, tag, doc, doc.positionAt(match.index).line));
		}
		if (memos.length !== 0) this._memoChanges.set(doc, memos);
		if (updateWebview) this._viewProvider.updateView(this.getChanges());
	}
}

class MemoEntry {
	public id: string;
	constructor(
		public content: string,
		public tag: string,
		public readonly file: vscode.TextDocument,
		public readonly line: number,
	) {}

	getId() {
		return `${vscode.workspace.asRelativePath(this.file.uri, false)}?${this.line}`;
	}
}

export class memoExplorerViewProvider implements vscode.WebviewViewProvider {
	constructor(private readonly _extensionUri: vscode.Uri, private readonly _memoFetcher: MemoFetcher) {}

	private _view?: vscode.WebviewView;
	private _webview?: vscode.Webview;

	public async resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;
		this._webview = webviewView.webview;

		this._webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
		};

		await this._memoFetcher.init(this);
		this._webview.html = this._getHtmlTemplate();
		webviewView.onDidChangeVisibility(() => {
			this.updateView(this._memoFetcher.getChanges());
		});
	}
	public updateView(changes: string) {
		if (!(this._webview && this._view?.visible)) return;
		this._webview.postMessage({ command: "update", _changes: changes });
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
				</head>
				<body>
				<p>anchor</p>
				<div id="explorer-root"></div>
				</body>
				<script defer src="${this._webview.asWebviewUri(
					vscode.Uri.joinPath(this._extensionUri, "media", "webview.js"),
				)}"></script>
			</html>`;
	}
}
