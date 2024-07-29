import { Position, Range, Selection, TextDocument, Uri, window, workspace, WorkspaceEdit } from "vscode";
import { readFile, writeFile } from "fs";

export namespace FE {
	const textEncoder = new TextEncoder();
	type EditRange = [start: number | Position, end: number | Position];
	type FileEdits = Map<EditRange, string>;

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

		/**
		 * Uses workspaceEdit if possible and NodeJS fs if file is closed.
		 * If fs failed, will show the document and attempt workspaceEdit
		 * The function DOES NOT check if the edit ranges are valid
		 * @param metaData only applies if file is open in the editor
		 */
		async apply(metaData?: { isRefactoring?: boolean }) {
			const editWithFs = async (edits: FileEdits, doc: TextDocument) => {
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
			};
			const editFile = async (edits: FileEdits, uri: Uri) => {
				workspace.openTextDocument(uri).then(async (doc) => {
					if (doc.isClosed) {
						try {
							editWithFs(edits, doc);
							return;
						} catch(err) {
							await window.showTextDocument(doc).then((editor) => {
								let pos = Array.from(edits.keys())[0][0];
								if (typeof pos === "number") pos = doc.positionAt(pos);
								editor.selection = new Selection(pos, pos);
								editor.revealRange(new Range(pos, pos));
							});
						}
					}
					const edit = new WorkspaceEdit();
					edits.forEach((text, [start, end]) => {
						if (typeof start === "number") start = doc.positionAt(start);
						if (typeof end === "number") end = doc.positionAt(end);
						edit.replace(uri, new Range(start, end), text);
					});
					workspace.applyEdit(edit, metaData).then(() => doc.save());
				});
			};
			this.edits.forEach(async (fileEdits, uri) => {
				try {
					editFile(fileEdits, uri);
				} catch (err) {
					throw new Error(`Error when applying edits to file: ${err}`);
				}
			});
		}
	}
}
