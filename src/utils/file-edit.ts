import { writeFileSync } from "fs";
import { commands, env, Position, Range, TextDocument, UIKind, Uri, window, workspace, WorkspaceEdit } from "vscode";

export namespace FileEdit {
	export type EditRange = [start: number | Position, end: number | Position];
	export type EditEntries = { range: EditRange; edit: string }[];

	export class Edit {
		private uriEditsMap: Map<Uri, EditEntries> = new Map();

		replace(uri: Uri, range: EditRange | Range, text: string): void {
			if (range instanceof Range) range = [range.start, range.end];
			if (!this.uriEditsMap.has(uri)) this.uriEditsMap.set(uri, []);
			this.uriEditsMap.get(uri).push({ range: <EditRange>range, edit: text });
		}

		delete(uri: Uri, range: EditRange | Range): void {
			this.replace(uri, range, "");
		}

		insert(uri: Uri, offset: number, text: string): void {
			this.replace(uri, [offset, offset], text);
		}

		reset(): void {
			this.uriEditsMap.clear();
		}

		async apply(options?: {
			alwaysOpenFile?: boolean;
			throwError?: boolean;
		}): Promise<void> {
			for (const [uri, fileEdits] of this.uriEditsMap.entries()) {
				try {
					await this.editFile(fileEdits, uri, options?.alwaysOpenFile);
				} catch (err) {
					if (options?.throwError) throw new Error(`Failed to apply edits to files: ${err}`);
				}
			}
		}

		private async editFile(
			edits: EditEntries,
			uri: Uri,
			alwaysOpenFile?: boolean,
		): Promise<void> {
			const doc = await workspace.openTextDocument(uri);
			if (!alwaysOpenFile && !doc.isDirty && env.uiKind !== UIKind.Web) {
				this.editFileWithFs(edits, doc);
				return;
			}

			await window.showTextDocument(doc);
			await commands.executeCommand("workbench.action.files.saveWithoutFormatting", doc);
			const wsEdit = new WorkspaceEdit();
			for (const [_, { range, edit }] of edits.entries()) {
				let [start, end] = range;
				if (typeof start === "number") start = doc.positionAt(start);
				if (typeof end === "number") end = doc.positionAt(end);
				wsEdit.replace(uri, new Range(start, end), edit);
			}

			try {
				await workspace.applyEdit(wsEdit);
				await commands.executeCommand("workbench.action.files.saveWithoutFormatting", doc);
			} catch (err) {
				throw new Error(`Failed modifying ${uri.path}: ${err}`);
			}
		}

		private editFileWithFs(edits: EditEntries, doc: TextDocument): void {
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
	}
}
