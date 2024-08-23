import { commands, Position, Range, TextDocument, Uri, window, workspace, WorkspaceEdit } from "vscode";
import { readFileSync, writeFileSync } from "fs";

export namespace FE {
	const textDecoder = new TextDecoder();

	type EditRange = [start: number | Position, end: number | Position];
	type FileEdits = Map<EditRange, string>;
	type FileEditMetaData = { isRefactoring?: boolean };

	export class FileEdit {
		private edits: Map<Uri, FileEdits> = new Map();

		replace(uri: Uri, range: EditRange | Range, text: string): void {
			if (range instanceof Range) range = [range.start, range.end];
			if (range.length !== 2) throw new Error(`Range must contain (only) start and end: ${range}`);
			if (!this.edits.has(uri)) this.edits.set(uri, new Map());
			this.edits.get(uri).set(<[number, number]>range, text);
		}

		delete(uri: Uri, range: EditRange | Range): void {
			this.replace(uri, range, "");
		}

		insert(uri: Uri, offset: number, text: string): void {
			this.replace(uri, [offset, offset], text);
		}

		async apply(metaData?: FileEditMetaData, alwaysOpenFile?: boolean): Promise<void> {
			this.edits.forEach((fileEdits, uri) => {
				this.editFile(fileEdits, uri, metaData, alwaysOpenFile).catch((err) => {
					throw new Error(`Error when applying edits to files: ${err}`);
				});
			});
		}

		reset(): void {
			this.edits.clear();
		}

		private editFileWithFs(edits: FileEdits, doc: TextDocument): void {
			const uri = doc.uri;
			let text = textDecoder.decode(readFileSync(uri.fsPath));
			let delta = 0;
			edits.forEach((edit, [start, end]) => {
				if (typeof start !== "number") start = doc.offsetAt(start);
				if (typeof end !== "number") end = doc.offsetAt(end);
				text = text.slice(0, start - delta) + edit + text.slice(end - delta);
				delta += end - start - text.length;
			});
			writeFileSync(uri.fsPath, text);
		}

		private async editFile(
			edits: FileEdits,
			uri: Uri,
			metaData?: FileEditMetaData,
			alwaysOpenFile?: boolean,
		): Promise<void> {
			workspace.openTextDocument(uri).then(async (doc) => {
				if (!alwaysOpenFile && !doc.isDirty) {
					this.editFileWithFs(edits, doc);
					return;
				}
				await window
					.showTextDocument(doc)
					.then(() => commands.executeCommand("workbench.action.files.saveWithoutFormatting", doc));
				const edit = new WorkspaceEdit();
				edits.forEach((text, [start, end]) => {
					if (typeof start === "number") start = doc.positionAt(start);
					if (typeof end === "number") end = doc.positionAt(end);
					edit.replace(uri, new Range(start, end), text);
				});
				workspace
					.applyEdit(edit, metaData)
					.then(() =>
						doc.save().then(
							(succeed) => {
								if (!succeed) throw new Error(`Error when saving ${uri.path}`);
							},
							() => null,
						),
					)
					.then(
						() => null,
						(err) => {
							throw new Error(`Error when modifying ${uri.path}: ${err}`);
						},
					);
			});
		}
	}

	function getFsPathOfOpenDocs(): string[] {
		const tabGroups = window.tabGroups.all;
		const fsPaths = [];
		for (const tabGroup of tabGroups) {
			for (const tab of tabGroup.tabs) {
				if (!tab.input || Object.getPrototypeOf(tab.input).constructor.name !== "Kn") continue;
				//@ts-ignore
				fsPaths.push(tab.input.uri.fsPath);
			}
		}
		return fsPaths;
	}
}
