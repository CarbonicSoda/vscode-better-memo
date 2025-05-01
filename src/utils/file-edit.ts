import { writeFileSync } from "fs";
import {
	commands,
	env,
	Position,
	Range,
	TextDocument,
	UIKind,
	Uri,
	window,
	workspace,
	WorkspaceEdit,
} from "vscode";

/**
 * Handles complicated logic of hybrid file editing with Node.fs and {@link workspace.fs},
 * this is due to how vscode requires editors to be open when using {@link workspace.fs}
 */
export namespace FileEdit {
	/**
	 * Specifies a text range [`start`, `end`) to get modified
	 */
	export type EditRange = [start: number | Position, end: number | Position];
	/**
	 * Maps {@link EditRange}s to replacement string
	 */
	export type EditEntries = { range: EditRange; edit: string }[];

	/**
	 * Defines a new edit collection that would be applied at once
	 *
	 * Text ranges' delta would be calculated internally,
	 * using original doc's range is sufficient
	 */
	export class Edit {
		private uriEditsMap: Map<Uri, EditEntries> = new Map();

		/**
		 * Replaces text in `range`, `range`.end is not included
		 */
		replace(uri: Uri, range: EditRange | Range, text: string): void {
			if (range instanceof Range) range = [range.start, range.end];

			if (!this.uriEditsMap.has(uri)) this.uriEditsMap.set(uri, []);
			this.uriEditsMap
				.get(uri)!
				.push({ range: range as EditRange, edit: text });
		}

		/**
		 * Deletes text in `range`, `range`.end is not included
		 */
		delete(uri: Uri, range: EditRange | Range): void {
			this.replace(uri, range, "");
		}

		/**
		 * Applies all previously stacked edits in order hybridly
		 *
		 * @param options.alwaysOpenFile: Always open the modified files and use {@link workspace.fs};
		 */
		async apply(options?: { alwaysOpenFile?: boolean }): Promise<void> {
			for (const [uri, fileEdits] of this.uriEditsMap.entries()) {
				try {
					await this.editFile(fileEdits, uri, options?.alwaysOpenFile);
				} catch {}
			}
		}

		/**
		 * Applies `edits` to the document with `uri` hybridly
		 */
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
			await commands.executeCommand(
				"workbench.action.files.saveWithoutFormatting",
				doc,
			);

			const wsEdit = new WorkspaceEdit();
			for (const [, { range, edit }] of edits.entries()) {
				let [start, end] = range;
				if (typeof start === "number") start = doc.positionAt(start);
				if (typeof end === "number") end = doc.positionAt(end);

				wsEdit.replace(uri, new Range(start, end), edit);
			}

			await workspace.applyEdit(wsEdit);
			await commands.executeCommand(
				"workbench.action.files.saveWithoutFormatting",
				doc,
			);
		}

		/**
		 * Applies `edits` to the `doc` with Node.fs
		 */
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
