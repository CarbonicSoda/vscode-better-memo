import { writeFileSync } from "fs";
import { commands, Position, Range, TextDocument, Uri, window, workspace, WorkspaceEdit } from "vscode";
import { Aux } from "./auxiliary";

type EditRange = [start: number | Position, end: number | Position];
type FileEdits = { range: EditRange; edit: string }[];
type FileEditMetaData = { isRefactoring?: boolean };

export class FileEdit {
	private edits: Map<Uri, FileEdits> = new Map();

	async replace(uri: Uri, range: EditRange | Range, text: string): Promise<void> {
		if (range instanceof Range) range = [range.start, range.end];
		if (!this.edits.has(uri)) this.edits.set(uri, []);
		this.edits.get(uri).push({ range: <EditRange>range, edit: text });
	}

	async delete(uri: Uri, range: EditRange | Range): Promise<void> {
		await this.replace(uri, range, "");
	}

	async insert(uri: Uri, offset: number, text: string): Promise<void> {
		await this.replace(uri, [offset, offset], text);
	}

	async apply(metaData?: FileEditMetaData, alwaysOpenFile?: boolean): Promise<void> {
		for (const [uri, fileEdits] of this.edits.entries()) {
			try {
				await this.editFile(fileEdits, uri, metaData, alwaysOpenFile);
			} catch (err) {
				throw new Error(`Failed to apply edits to files: ${err}`);
			}
		}
	}

	async reset(): Promise<void> {
		this.edits.clear();
	}

	private async editFileWithFs(edits: FileEdits, doc: TextDocument): Promise<void> {
		let text = doc.getText();
		let delta = 0;
		for (let { range, edit } of edits) {
			let [start, end] = range;
			if (typeof start !== "number") start = doc.offsetAt(start);
			if (typeof end !== "number") end = doc.offsetAt(end);
			text = text.slice(0, start - delta) + edit + text.slice(end - delta);
			delta += end - start - edit.length;
		}
		writeFileSync(doc.uri.fsPath, text);
	}

	private async editFile(
		edits: FileEdits,
		uri: Uri,
		metaData?: FileEditMetaData,
		alwaysOpenFile?: boolean,
	): Promise<void> {
		const doc = await workspace.openTextDocument(uri);
		if (!alwaysOpenFile && !doc.isDirty) {
			await this.editFileWithFs(edits, doc);
			return;
		}
		await window.showTextDocument(doc);
		await commands.executeCommand("workbench.action.files.saveWithoutFormatting", doc);
		const wsEdit = new WorkspaceEdit();
		await Aux.async.map(edits.entries(), async ([_, { range, edit }]) => {
			let [start, end] = range;
			if (typeof start === "number") start = doc.positionAt(start);
			if (typeof end === "number") end = doc.positionAt(end);
			wsEdit.replace(uri, new Range(start, end), edit);
		});
		try {
			await workspace.applyEdit(wsEdit, metaData);
			await commands.executeCommand("workbench.action.files.saveWithoutFormatting", doc);
		} catch (err) {
			throw new Error(`Failed modifying ${uri.path}: ${err}`);
		}
	}
}
