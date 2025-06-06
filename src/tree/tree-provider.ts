import {
	commands,
	Event,
	MarkdownString,
	TreeDataProvider,
	EventEmitter as VSEventEmitter,
} from "vscode";

import { Doc } from "../engine/doc";
import { Memo } from "../engine/memo";
import { Tag } from "../engine/tag";
import { Aux } from "../utils/auxiliary";
import { Config } from "../utils/config";
import { TreeItem } from "./tree-item";

export class TreeProvider implements TreeDataProvider<TreeItem.ItemType> {
	private dataChangeEmitter: VSEventEmitter<void> = new VSEventEmitter<void>();

	onDidChangeTreeData: Event<void> = this.dataChangeEmitter.event;

	getTreeItem(element: TreeItem.ItemType) {
		return element;
	}

	getParent(element: TreeItem.ItemType) {
		return element.parent;
	}

	getChildren(element: undefined | TreeItem.ItemType) {
		if (element === undefined) return this.items;

		if ("children" in element) return element.children;

		return undefined;
	}

	private $view: "tag" | "file" = "tag";

	get view(): typeof this.$view {
		return this.$view;
	}
	set view(type: typeof this.$view) {
		this.$view = type;

		commands.executeCommand(
			"setContext",
			"better-memo.explorerView",
			this.view,
		);
	}

	constructor() {
		this.view = Config.get("defaultView") as typeof this.view;
	}

	items: TreeItem.PrimaryType[] = [];

	get memos(): TreeItem.MemoType[] {
		return this.items.flatMap((primary) =>
			primary.children.flatMap((secondary) => secondary.children),
		);
	}

	flush(): void {
		this.dataChangeEmitter.fire();
	}

	refresh(expand: { primary: boolean; secondary: boolean }): void {
		this.items = this.getItems(expand);

		commands.executeCommand(
			"setContext",
			"better-memo.noMemos",
			this.items.length === 0,
		);

		this.flush();
	}

	private getItems(expand: {
		primary: boolean;
		secondary: boolean;
	}): typeof this.items {
		return this.view === "tag"
			? this.getTagViewItems(expand)
			: this.getFileViewItems(expand);
	}

	private getTagViewItems(expand: {
		primary: boolean;
		secondary: boolean;
	}): typeof this.items {
		const items: typeof this.items = [];

		const tags = Tag.data.tags.sort();

		for (const tag of tags) {
			const tagItem = new TreeItem.TagItem<"primary">(
				tag,
				expand.primary,
				undefined,
			);

			const memos = Memo.ofTag(tag);
			if (memos.length === 0) continue;

			const fileGroups = Array.from(
				Aux.object.group(memos, (memo) => memo.meta.doc).entries(),
			).sort(([docA], [docB]) => docA.fileName.localeCompare(docB.fileName));

			let memoCount = 0;

			tagItem.children = fileGroups.map(([doc, memos]) => {
				memoCount += memos.length;

				const fileItem = new TreeItem.FileItem<"secondary">(
					doc.uri,
					expand.secondary,
					tagItem,
				);

				memos
					.sort((memoA, memoB) => memoA.meta.line - memoB.meta.line)
					.sort((memoA, memoB) => memoB.priority - memoA.priority);

				const maxPriority = memos[0].priority;

				fileItem.children = memos.map((memo) => {
					return new TreeItem.MemoItem(
						memo,
						maxPriority === 0 ? 0 : memo.priority / maxPriority,
						fileItem,
					);
				});

				fileItem.description = `${memos.length} Memo${Aux.string.plural(
					memos,
				)}`;

				fileItem.tooltip = new MarkdownString(
					`$(file) ${fileItem.label} $(dash) ${memos.length} $(pencil)`,
					true,
				);

				return fileItem;
			});

			tagItem.description = `${fileGroups.length} File${Aux.string.plural(
				fileGroups,
			)} > ${memoCount} Memo${Aux.string.plural(memoCount)}`;

			tagItem.tooltip = new MarkdownString(
				`$(bookmark) ${tagItem.label} $(dash) ${fileGroups.length} $(file) ${memoCount} $(pencil)`,
				true,
			);

			items.push(tagItem);
		}

		return items;
	}

	private getFileViewItems(expand: {
		primary: boolean;
		secondary: boolean;
	}): typeof this.items {
		const items: typeof this.items = [];

		const docs = Doc.data.docs.sort((docA, docB) => {
			return docA.fileName.localeCompare(docB.fileName);
		});

		for (const doc of docs) {
			const fileItem = new TreeItem.FileItem<"primary">(
				doc.uri,
				expand.primary,
				undefined,
			);

			const memos = Memo.inDoc(doc);
			if (memos.length === 0) continue;

			const tagGroups = Array.from(
				Aux.object.group(memos, (memo) => memo.tag).entries(),
			).sort(([tagA], [tagB]) => tagA.localeCompare(tagB));

			let memoCount = 0;

			fileItem.children = tagGroups.map(([tag, memos]) => {
				memoCount += memos.length;

				const tagItem = new TreeItem.TagItem<"secondary">(
					tag,
					expand.secondary,
					fileItem,
				);

				memos
					.sort((memoA, memoB) => memoA.meta.line - memoB.meta.line)
					.sort((memoA, memoB) => memoB.priority - memoA.priority);

				const maxPriority = memos[0].priority;

				tagItem.children = memos.map((memo) => {
					return new TreeItem.MemoItem(
						memo,
						maxPriority === 0 ? 0 : memo.priority / maxPriority,
						tagItem,
					);
				});

				tagItem.description = `${memos.length} Memo${Aux.string.plural(memos)}`;

				tagItem.tooltip = new MarkdownString(
					`$(bookmark) ${tagItem.label} $(dash) ${memos.length} $(pencil)`,
					true,
				);

				return tagItem;
			});

			fileItem.description = `${tagGroups.length} Tag${Aux.string.plural(
				tagGroups,
			)} > ${memoCount} Memo${Aux.string.plural(memoCount)}`;

			fileItem.tooltip = new MarkdownString(
				`$(file) ${fileItem.label} $(dash) ${tagGroups.length} $(bookmark) ${memoCount} $(pencil)`,
				true,
			);

			items.push(fileItem);
		}

		return items;
	}
}
