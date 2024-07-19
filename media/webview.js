const vscode = acquireVsCodeApi();
const fallbackExplorerDefaultState = {};
let _explorerState = fallbackExplorerDefaultState;
function main() {
	addEventListener("message", handleMessage);
}
function handleMessage(ev) {
	const message = ev.data;
	switch (message.command) {
		case "load":
			_explorerState = vscode.getState() || (message._state ?? fallbackExplorerDefaultState);
			loadContent(message._memos);
			break;
		case "update":
			updateContent(message._changes);
			break;
		case "dispose":
			dispose();
			break;
	}
}

const explorerRoot = document.querySelector("#explorer-root");
let _explorerChild = {};
function loadContent(memos) {
	console.log(memos);
}
function updateContent(changes) {
	console.log(changes);
}
function updateState() {
	vscode.setState(_explorerState);
}
function dispose() {
	removeEventListener("message", handleMessage);
}

main();
