import * as vscode from "vscode";

export class MemoFetcher {
	public tags: Set<string> = new Set();
	public memos: Map<vscode.TextDocument, MemoEntry[]> = new Map();

	private readonly _commentHeaders = ["//", "#", "/*", "<!--"];
	private readonly _commentTrails: { [header: string]: string } = {
		"/*": "*/",
		"<!--": "-->",
	};
	private readonly _headerPattern = `(?<head>${this._commentHeaders.join("|")})\\s?mo\\s+`;
	private readonly _matchPattern = new RegExp(`${this._headerPattern}(?<tag>\\S+)\\s+(?<content>.*)$`, "gmi");

	private _viewProvider: memoExplorerViewProvider;
	private _configMaid = ConfigMaid.get();
	private _watchedDocs: vscode.TextDocument[] = [];
	private _memoChanges: Map<vscode.TextDocument, MemoEntry[]> = new Map();

	private _events: vscode.Disposable[] = [];
	private _intervals: NodeJS.Timeout[] = [];

	public async init(viewProvider: memoExplorerViewProvider) {
		this._viewProvider = viewProvider;
		await this._fetchDocs();
		this._events.push(
			vscode.workspace.onDidCreateFiles(() => {
				this._fetchDocs();
			}),
			vscode.workspace.onDidDeleteFiles((ev) => {
				this._watchedDocs = this._watchedDocs.filter((doc) => !ev.files.includes(doc.uri)); //test if this works
			}),
		);

		this._watchedDocs.forEach((doc) => this._scanDoc(doc));
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
			}, this._configMaid.scanDelay),
		);

		viewProvider.loadViewContent();
	}
	public getChanges() {
		const changes: { [fileName: string]: MemoEntry[] } = {};
		this._memoChanges.forEach((memos, doc) => {
			changes[doc.fileName] = memos;
		});
		this._memoChanges.clear();
		return changes;
	}
	public dispose() {
		for (const event of this._events) event.dispose();
		for (const interval of this._intervals) clearInterval(interval);
	}

	private async _fetchDocs() {
		try {
			this._watchedDocs = await Promise.all(
				await vscode.workspace
					.findFiles(this._configMaid.watchGlob, this._configMaid.ignoreGlob)
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
		if (memos.length !== 0) {
			this.memos.set(doc, memos);
			this._memoChanges.set(doc, memos);
		}
		if (updateWebview) this._viewProvider.updateViewContent();
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

class ConfigMaid {
	static instance?: ConfigMaid;
	static get() {
		const maid = ConfigMaid.instance ?? (ConfigMaid.instance = new ConfigMaid());
		maid._init();
		return maid;
	}

	public watchGlob: vscode.GlobPattern;
	public ignoreGlob: vscode.GlobPattern;
	public scanDelay: number;

	private _config: vscode.WorkspaceConfiguration;
	private _hadInit = false;
	private _events: vscode.Disposable[] = [];

	public dispose() {
		for (const event of this._events) event.dispose();
	}

	private _init() {
		if (this._hadInit) return;
		this._config = vscode.workspace.getConfiguration("better-memo");
		this._events.push(
			vscode.workspace.onDidChangeConfiguration((ev) => {
				if (!ev.affectsConfiguration("better-memo")) return;
				this._fetchConfigs();
			}),
		);
		this._hadInit = true;
	}
	private _fetchConfigs() {
		this.watchGlob = `{${this._config.get<string[]>("watch").join(",")}}`;
		this.ignoreGlob = `{${this._config.get<string[]>("ignore").join(",")}}`;
		this.scanDelay = this._config.get("scanDelay");
	}
}

interface ExplorerState {}

export class memoExplorerViewProvider implements vscode.WebviewViewProvider {
	constructor(private readonly _extensionUri: vscode.Uri, private readonly _memoFetcher: MemoFetcher) {}

	public defaultExplorerState: ExplorerState = {}; //remember to add fetch config

	private _view?: vscode.WebviewView;
	private _webview?: vscode.Webview;
	private _explorerState?: ExplorerState;

	private _events: vscode.Disposable[] = [];

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
		this._events.push(
			webviewView.onDidChangeVisibility(() => {
				this.loadViewContent();
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
	public loadViewContent() {
		if (!(this._webview && this._view?.visible)) return;
		this._webview.postMessage({
			command: "load",
			_memos: this._memoFetcher.memos,
			_state: this._explorerState,
		});
	}
	public updateViewContent() {
		if (!(this._webview && this._view?.visible)) return;
		this._webview.postMessage({ command: "update", _changes: this._memoFetcher.getChanges() });
	}
	public dispose() {
		for (const event of this._events) event.dispose();
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
