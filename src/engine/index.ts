import { commands, Uri, window, workspace } from "vscode";

import { Config } from "../utils/config";
import { EventEmitter } from "../utils/event-emitter";
import { Janitor } from "../utils/janitor";
import { Doc } from "./doc";
import { Format } from "./format";
import { Lang } from "./lang";
import { Scan } from "./scan";
import { Tag } from "./tag";

export async function initEngine(): Promise<void> {
	Config.onChange("customTags", () => {
		Tag.data = Tag.getData();
		updateView();
	});

	Config.onChange("customLangs", async () => {
		Lang.data = Lang.getData();
		await Scan.filesChanged();
		updateView();
	});

	Config.onChange(["watch", "ignore"], async () => {
		await Scan.filesChanged();
		updateView();
	});

	Config.schedule(async () => {
		const scanned = await Scan.activeDoc();
		if (scanned) updateView();
	}, "scanDelay");

	Config.schedule(async () => {
		await Scan.clean();
		updateView();
	}, "cleanScanDelay");

	Janitor.add(
		commands.registerCommand("better-memo.refresh", async () => {
			await Scan.clean();
			updateView();
		}),

		workspace.onDidChangeWorkspaceFolders(async () => {
			await Scan.filesChanged();
			updateView();
		}),

		workspace.onDidCreateFiles(async () => {
			await Scan.filesChanged();
			updateView();
		}),
		workspace.onDidDeleteFiles(async () => {
			await Scan.filesChanged();
			updateView();
		}),

		workspace.onDidSaveTextDocument(async () => {
			const scanned = await Scan.activeDoc();
			if (scanned) updateView();
		}),

		window.onDidChangeActiveColorTheme(() => {
			Tag.data = Tag.getData();
			updateView();
		}),

		window.tabGroups.onDidChangeTabs(async (ev) => {
			for (const tab of ev.closed) {
				let doc;
				try {
					doc = await workspace.openTextDocument(
						(tab.input as { uri: Uri }).uri,
					);
				} catch {
					continue;
				}

				if (Doc.includes(doc)) await Format.formatDoc(doc);
			}
		}),
	);

	await Scan.filesChanged();
}

function updateView(): void {
	EventEmitter.emit("Update");
}
