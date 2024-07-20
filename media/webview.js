const vscode = acquireVsCodeApi();
const fallbackExplorerDefaultState = {
	primaryGroup: "Files",
};
let explorerState = fallbackExplorerDefaultState;
let fileMemos = {};
let tags = [];
function main() {
	addEventListener("message", handleMessage);
}
function handleMessage(ev) {
	const message = ev.data;
	switch (message.command) {
		case "load":
			console.log("Webview load event triggered");
			explorerState = vscode.getState() || (message._defaultState ?? fallbackExplorerDefaultState);
			tags = message._tags;
			console.log("$ ~ file: webview.js:18 ~ handleMessage ~ tags:", tags);
			loadMemos(message._memos);
			console.log("$ ~ file: webview.js:32 ~ handleMessage ~ message._memos:", message._memos);
			loadViewContent();
			break;
		case "update":
			console.log("Webview update event triggered");
			tags = message._tags;
			updateMemos(message._changes);
			loadViewContent();
			break;
		case "dispose":
			console.log("Webview dispose event triggered");
			dispose();
			break;
	}
}

const explorerRoot = document.querySelector("#explorer-root");
function loadMemos(_memos) {
	fileMemos = {};
	for (const [fileName, memos] of Object.entries(_memos)) if (memos.length !== 0) fileMemos[fileName] = memos;
}
function updateMemos(_changes) {
	for (const [fileName, memos] of Object.entries(_changes)) fileMemos[fileName] = memos;
	for (const [fileName, memos] of Object.entries(fileMemos)) if (memos.length === 0) delete fileMemos[fileName];
}
function loadViewContent() {
	console.log(_getGroups());
}
function _getMemos() {
	return [...Object.values(fileMemos)];
}
function _getGroups() {
	const primaryGroup = Object.groupBy(
		_getMemos(),
		explorerState.primaryGroup === "Files" ? ({ file }) => file : ({ tag }) => tag,
	);
	const parents = Object.keys(primaryGroup).toSorted();
	const children = [];
	const leaves = [];
	for (const parent of parents) {
		const subGroup = Object.groupBy(
			primaryGroup[parent],
			explorerState.primaryGroup === "Files" ? ({ tag }) => tag : ({ file }) => file,
		);
		const child = Object.keys(subGroup).toSorted();
		children.push(child);
		for (const leaf of child) leaves.push(leaf.toSorted((a, b) => a._offset - b._offset));
	}
	return {
		parents,
		children,
		leaves,
	};
}

function updateState() {
	vscode.setState(explorerState);
}
function dispose() {
	removeEventListener("message", handleMessage);
}

main();
