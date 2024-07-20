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
			explorerState = vscode.getState() || (message._defaultState ?? fallbackExplorerDefaultState);
			tags = message._tags;
			loadMemos(message._memos);
			loadViewContent();
			break;
		case "update":
			tags = message._tags;
			updateMemos(message._changes);
			loadViewContent(); //more sophisticated updating that doesnt require reload later
			break;
		case "dispose":
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
	const groups = _getGroups();
	let innerHtml = "";
	for (let i_p = 0; i_p < groups.parents.length; i_p++) {
		const parent = groups.parents[i_p];
		innerHtml += `<div id="r?p?${i_p}" class="explorer-parent">
		<div class="parent-name">${parent}</div>`;
		const child = groups.children[i_p];
		for (let i_c = 0; i_c < child.length; i_c++) {
			const _child = child[i_c];
			innerHtml += `<div id="p?${i_p}c?${i_c}" class="explorer-child">
			<div class="child-name">${_child}</div>`;
			const leaf = groups.leaves[i_p][i_c];
			for (let i_l = 0; i_l < leaf.length; i_l++) {
				const _leaf = leaf[i_l];
				innerHtml += `<div id="c?${i_c}l?${i_l}" class="explorer-leaf">
					<div class="leaf-content">${_leaf.content}</div>
					<div class="leaf-line">Ln ${_leaf.line}</div>
				</div>`;
			}
			innerHtml += "</div>";
		}
		innerHtml += "</div>";
	}
	explorerRoot.innerHTML = innerHtml;
}

function _getMemos() {
	return [...Object.values(fileMemos)].flat();
}
function _getGroups() {
	function objectGroupBy(iterableOfObjects, grouper) {
		const groups = {};
		for (const object of iterableOfObjects) {
			if (!groups[object[grouper]]) groups[object[grouper]] = [];
			groups[object[grouper]].push(object);
		}
		return groups;
	}
	const primaryGroup = objectGroupBy(_getMemos(), explorerState.primaryGroup === "Files" ? "path" : "tag");
	const parents = Object.keys(primaryGroup).toSorted();
	const children = [];
	const leaves = [];
	for (const parent of parents) {
		const subGroup = objectGroupBy(
			primaryGroup[parent],
			explorerState.primaryGroup === "Files" ? "tag" : "path",
		);
		const child = Object.keys(subGroup).toSorted();
		children.push(child);
		const leaf = [];
		for (const _child of child) leaf.push(subGroup[_child].toSorted((a, b) => a._offset - b._offset));
		leaves.push(leaf);
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
