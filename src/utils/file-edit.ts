import { writeFileSync } from "fs";
import { commands, Position, Range, TextDocument, Uri, window, workspace, WorkspaceEdit } from "vscode";
import { Aux } from "./auxiliary";

type EditRange = [start: number | Position, end: number | Position];
type FileEdits = Map<EditRange, string>;
type FileEditMetaData = { isRefactoring?: boolean };

export class FileEdit {
	private edits: Map<Uri, FileEdits> = new Map();

	async replace(uri: Uri, range: EditRange | Range, text: string): Promise<void> {
		if (range instanceof Range) range = [range.start, range.end];
		if (range.length !== 2) throw new Error(`Range must contain (only) start and end: ${range}`);
		if (!this.edits.has(uri)) this.edits.set(uri, new Map());
		this.edits.get(uri).set(<EditRange>range, text);
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
		for (let [[start, end], replacement] of edits.entries()) {
			if (typeof start !== "number") start = doc.offsetAt(start);
			if (typeof end !== "number") end = doc.offsetAt(end);
			text = text.slice(0, start - delta) + replacement + text.slice(end - delta);
			delta += end - start - replacement.length;
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
		const edit = new WorkspaceEdit();
		await Aux.async.map(edits.entries(), async ([[start, end], replacement]) => {
			if (typeof start === "number") start = doc.positionAt(start);
			if (typeof end === "number") end = doc.positionAt(end);
			edit.replace(uri, new Range(start, end), replacement);
		});
		try {
			await workspace.applyEdit(edit, metaData);
			await commands.executeCommand("workbench.action.files.saveWithoutFormatting", doc);
		} catch (err) {
			throw new Error(`Failed modifying ${uri.path}: ${err}`);
		}
	}
}
