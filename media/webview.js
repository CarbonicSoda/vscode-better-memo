class ExplorerMaid {
	vscode = acquireVsCodeApi();
	explorerRoot = document.querySelector("#explorer-root");
	events = [];

	init() {
		this.events.push(
			window.addEventListener("message", (ev) => {
				const message = ev.data;
				switch (message.command) {
					case "load":
						this.loadContent(message._memos, message._state);
						break;
					case "update":
						this.updateContent(message._changes);
						break;
				}
			}),
		);
	}

	getHtml() {}

	loadContent(memos, explorerState) {}
	updateContent(changes) {}
	// getChild(key) {
	// 	const child = new Set();
	// 	for (const memo of this.memos) child.add(memo[key]);

	// 	let childList = [...childList.values()].sort();
	// 	switch (key) {
	// 		case "file":
	// 			childList.map((file) => file);
	// 	}

	// 	return;
	// }

	updateState() {
		state = {};
		vscode.postMessage({ command: "updateState", newState: state });
	}
}
