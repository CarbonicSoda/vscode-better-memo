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
	Config.onChange("general.customTags", () => {
		Tag.data = Tag.getData();
		updateView();
	});

	Config.onChange("general.customLangs", async () => {
		Lang.data = Lang.getData();
		await Scan.filesChanged();
		updateView();
	});

	Config.onChange(["fetcher.watch", "fetcher.ignore"], async () => {
		await Scan.filesChanged();
		updateView();
	});

	Config.schedule(Scan.currentDoc, "fetcher.scanDelay");

	Config.schedule(Scan.clean, "fetcher.cleanScanDelay");

	Janitor.add(
		commands.registerCommand("better-memo.reloadExplorer", async () => {
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

		workspace.onDidSaveTextDocument(Scan.currentDoc),

		window.onDidChangeActiveColorTheme(() => {
			Tag.data = Tag.getData();
			updateView();
		}),

		window.tabGroups.onDidChangeTabGroups(async (ev) => {
			for (const tab of ev.changed) {
				const activeTab = tab.activeTab;

				if (!tab.isActive || !activeTab || !activeTab?.isActive) {
					continue;
				}

				let doc;
				try {
					doc = await workspace.openTextDocument(
						(activeTab.input as { uri: Uri }).uri,
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
	EventEmitter.emit("UpdateView");
}
