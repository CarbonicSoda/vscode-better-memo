import { Position, Range, TextDocument, window, workspace } from "vscode";

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
	export type Edits = { range: EditRange; replace: string }[];

	/**
	 * Define a new edit collection that would be applied at once
	 *
	 * Text range deltas would be calculated internally,
	 * using original doc's range is sufficient
	 */
	export class Edit {
		private edits: Map<TextDocument, Edits> = new Map();

		get docs(): TextDocument[] {
			return Array.from(this.edits.keys());
		}

		/**
		 * Replace text in `range`, `range`.end is not included
		 */
		replace(
			doc: TextDocument,
			range: EditRange | Range,
			replace: string,
		): this {
			if (range instanceof Range) range = [range.start, range.end];

			if (!this.edits.has(doc)) this.edits.set(doc, []);
			this.edits.get(doc)!.push({ range, replace });

			return this;
		}

		/**
		 * Delete text in `range`, `range`.end is not included
		 */
		delete(doc: TextDocument, range: EditRange | Range): this {
			return this.replace(doc, range, "");
		}

		/**
		 * Apply all previously stacked edits in order
		 */
		async apply(): Promise<this> {
			for (const [doc, edits] of this.edits.entries()) {
				try {
					await this.editDoc(doc, edits);
				} catch {}
			}
			return this;
		}

		private async editDoc(doc: TextDocument, edits: Edits): Promise<void> {
			if (doc.isDirty) {
				await window.showInformationMessage(
					`Document ${workspace.asRelativePath(
						doc.uri,
					)} was dirty, edits not applied.`,
				);
				return;
			}

			let text = doc.getText();
			let delta = 0;

			for (let { range, replace: edit } of edits) {
				let [start, end] = range;
				if (typeof start !== "number") start = doc.offsetAt(start);
				if (typeof end !== "number") end = doc.offsetAt(end);

				text = text.slice(0, start - delta) + edit + text.slice(end - delta);
				delta += end - start - edit.length;
			}

			await workspace.fs.writeFile(doc.uri, new TextEncoder().encode(text));
		}
	}
}
