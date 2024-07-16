const explorerRoot = document.querySelector("#explorer-root");
const _memos = new Map();

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
	console.log(changes);
	explorerRoot.innerHTML = "";
	for (const change of changes) explorerRoot.innerHTML += `<p>${change.content}</p>`;
}

// function getChild(key) {
// 	const child = new Set();
// 	for (const memo of _memos) child.add(memo[key]);

// 	let childList = [...childList.values()].sort();
// 	switch (key) {
// 		case "file":
// 			childList.map((file) => file)
// 	}

// 	return ;
// }
