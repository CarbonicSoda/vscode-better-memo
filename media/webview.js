const explorerRoot = document.querySelector("#explorer-root");
const _memos = new Map();
explorerRoot.innerHTML="<p>yo</p>";

window.addEventListener("message", (ev) => {
	const data = ev.data;
	switch (data.command) {
		case "update":
		updateView(data._changes);
		break;
	}
});

function updateView(changes) {
	changes = JSON.parse(changes);
	console.log("🚀 ~ updateView ~ changes:", changes);
	// const memoChanged = changes
	// explorerRoot.innerHTML = "";
	// getMemos().forEach((memo) => {
		// explorerRoot.append(
			// <p>${memo.content}</p>
		// );
	// });
}