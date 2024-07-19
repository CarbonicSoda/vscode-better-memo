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
			console.log("load ev rec");
			_explorerState = vscode.getState() || (message._state ?? fallbackExplorerDefaultState);
			loadContent(message._memos);
			break;
		case "update":
			console.log("update ev rec");
			updateContent(message._changes);
			break;
		case "dispose":
			console.log("dispose ev rec");
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
