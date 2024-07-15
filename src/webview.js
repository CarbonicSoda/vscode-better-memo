const explorerRoot = document.querySelector("#explorer-root");
let memos = new Map();
function getMemos() {
	return [...memos.values].flat();
}

window.addEventListener("message", (ev) => {
	const data = ev.data;
	switch (data.command) {
		case "update":
		updateView(data.changes);
		break;
	}
});

function updateView(changes) {
	for (const docChanged of changes) {
		memos.set(docChanged, changes[docChanged]);
	}
	// change later, shall only update children that's changed
	explorerRoot.innerHTML = "";
	getMemos().forEach((memo) => {
		explorerRoot.append(
			<p>${memo.content}</p>
		);
	});
}