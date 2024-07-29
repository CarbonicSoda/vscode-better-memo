import {
	commands,
	Position,
	Range,
	Selection,
	TextDocument,
	Uri,
	ViewColumn,
	window,
	workspace,
	WorkspaceEdit,
} from "vscode";
import { readFile, writeFile } from "fs";

export namespace FE {
	const textEncoder = new TextEncoder();
	type EditRange = [start: number | Position, end: number | Position];
	type FileEdits = Map<EditRange, string>;
	type FileEditMetaData = { isRefactoring?: boolean };

	export class FileEdit {
		private edits: Map<Uri, FileEdits> = new Map();

		replace(uri: Uri, range: EditRange | Range, text: string) {
			if (range instanceof Range) range = [range.start, range.end];
			if (range.length !== 2) throw new Error(`Range must contain (only) start and end: ${range}`);
			if (!this.edits.has(uri)) this.edits.set(uri, new Map());
			this.edits.get(uri).set(<[number, number]>range, text);
		}
		delete(uri: Uri, range: EditRange | Range) {
			this.replace(uri, range, "");
		}
		insert(uri: Uri, offset: number, text: string) {
			this.replace(uri, [offset, offset], text);
		}
		getFsPathOfOpenDocs(): string[] {
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
		async apply(metaData?: FileEditMetaData, background?: boolean) {
			this.edits.forEach(async (fileEdits, uri) => {
				this.editFile(fileEdits, uri, metaData, background).catch((err) => {
					throw new Error(`Error when applying edits to files: ${err}`);
				});
			});
		}
		reset() {
			this.edits.clear();
		}

		private async editFileWithFs(edits: FileEdits, doc: TextDocument) {
			const uri = doc.uri;
			readFile(uri.fsPath, (err, data) => {
				if (err) throw new Error(`Error when reading file with NodeJS fs: ${err}`);
				let bits = [...data];
				let delta = 0;
				edits.forEach((text, [start, end]) => {
					if (typeof start !== "number") start = doc.offsetAt(start);
					if (typeof end !== "number") end = doc.offsetAt(end);
					bits = bits.slice(0, start - delta).concat([...textEncoder.encode(text)], bits.slice(end - delta));
					delta += end - start - text.length;
				});
				writeFile(uri.fsPath, Buffer.from(bits), (err) => {
					throw new Error(`Error when writing to file with NodeJS fs: ${err}`);
				});
			});
		}
		private async editFile(edits: FileEdits, uri: Uri, metaData?: FileEditMetaData, background?: boolean) {
			workspace.openTextDocument(uri).then(async (doc) => {
				if (background || !this.getFsPathOfOpenDocs().includes(doc.fileName)) {
					await this.editFileWithFs(edits, doc).catch((err) => {
						throw new Error(`Error when editing with NodeJS fs: ${err}`);
					});
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
				workspace.applyEdit(edit, metaData).then(() =>
					doc.save().then(
						(succeed) => {
							if (!succeed) throw new Error(`Error when saving document: ${doc.fileName}`);
						},
						() => null,
					),
				);
			});
		}
	}
}
