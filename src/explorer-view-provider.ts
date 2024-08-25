import {
	commands,
	Event,
	MarkdownString,
	ThemeIcon,
	TreeDataProvider,
	TreeView,
	EventEmitter as VSEventEmitter,
	window,
} from "vscode";
import { ETItems } from "./explorer-tree-items";
import { MemoEntry, MemoFetcher } from "./memo-fetcher";
import { Aux } from "./utils/auxiliary";
import { getConfigMaid } from "./utils/config-maid";
import { EventEmitter } from "./utils/event-emitter";
import { Janitor } from "./utils/janitor";

const eventEmitter = EventEmitter.getEventEmitter();
const configMaid = getConfigMaid();

export class ExplorerTreeView {
	memoFetcher: MemoFetcher;
	viewProvider: ExplorerViewProvider;

	private view: TreeView<ETItems.ExplorerTreeItemType>;
	private janitor = new Janitor();

	async init(memoFetcher: MemoFetcher): Promise<void> {
		configMaid.listen("view.defaultView");
		configMaid.listen("view.expandPrimaryItemsByDefault");
		configMaid.listen("view.expandSecondaryItemsByDefault");

		this.memoFetcher = memoFetcher;
		this.viewProvider = new ExplorerViewProvider(memoFetcher);
		this.updateViewType(null, true);
		await this.viewProvider.init();
		this.view = window.createTreeView("better-memo.memoExplorer", {
			treeDataProvider: this.viewProvider,
			showCollapseAll: true,
			canSelectMany: false,
		});

		this.janitor.add(
			this.view,

			configMaid.onChange("view.defaultView", (view) => this.updateViewType(view)),
			configMaid.onChange(["view.expandPrimaryItemsByDefault", "view.expandSecondaryItemsByDefault"], () =>
				eventEmitter.emit("updateItemCollapsibleState"),
			),

			eventEmitter.subscribe("updateView", () => this.viewProvider.reloadItems()),
			eventEmitter.subscribe("updateItemCollapsibleState", () => this.updateItemCollapsibleState()),

			window.onDidChangeActiveColorTheme(() => this.viewProvider.reloadItems()),
			this.view.onDidChangeVisibility((ev) => this.handleChangeVisibility(ev.visible)),

			commands.registerCommand("better-memo.switchToFileView", () => this.updateViewType("File")),
			commands.registerCommand("better-memo.switchToTagView", () => this.updateViewType("Tag")),
			commands.registerCommand("better-memo.explorerCompleteAll", () => this.explorerCompleteAll()),
			commands.registerCommand("better-memo.explorerExpandAll", () => this.explorerExpandAll()),

			commands.registerCommand("better-memo.navigateToFile", (fileItem: ETItems.FileItem) => fileItem.navigate()),
			commands.registerCommand("better-memo.completeFile", (fileItem: ETItems.FileItem) =>
				fileItem.completeMemos(this),
			),
			commands.registerCommand("better-memo.completeFileNoConfirm", (fileItem: ETItems.FileItem) =>
				fileItem.completeMemos(this, { noConfirmation: true }),
			),

			commands.registerCommand("better-memo.completeTag", (tagItem: ETItems.TagItem) =>
				tagItem.completeMemos(this),
			),
			commands.registerCommand("better-memo.completeTagNoConfirm", (tagItem: ETItems.TagItem) =>
				tagItem.completeMemos(this, { noConfirmation: true }),
			),

			commands.registerCommand("better-memo.navigateToMemo", (memoItem: ETItems.MemoItem) => memoItem.navigate()),
			commands.registerCommand("better-memo.completeMemo", (memoItem: ETItems.MemoItem) =>
				memoItem.complete(this),
			),
			commands.registerCommand("better-memo.confirmCompleteMemo", (memoItem: ETItems.MemoItem) =>
				memoItem.complete(this),
			),
			commands.registerCommand("better-memo.completeMemoNoConfirm", (memoItem: ETItems.MemoItem) =>
				memoItem.complete(this, { noConfirmation: true }),
			),
		);

		commands.executeCommand("setContext", "better-memo.explorerInitFinished", true);
	}

	dispose(): void {
		this.janitor.clearAll();
	}

	private updateViewType(view?: "File" | "Tag", noReload?: boolean): void {
		this.viewProvider.viewType = view = view ?? configMaid.get("view.defaultView");
		commands.executeCommand("setContext", "better-memo.explorerView", view);
		if (noReload) return;
		this.viewProvider.reloadItems();
	}

	private updateItemCollapsibleState(): void {
		this.view.reveal(this.viewProvider.items[0], { select: false, focus: true }).then(() => {
			Promise.resolve(commands.executeCommand("list.collapseAll")).finally(async () => {
				if (configMaid.get("view.expandSecondaryItemsByDefault")) {
					const reveals = [];
					for (const item of this.viewProvider.items) {
						for (const child of item.children)
							reveals.push(this.view.reveal(child, { select: false, expand: true }));
					}
					await Promise.allSettled(reveals);
				}
				for (const item of this.viewProvider.items) {
					if (configMaid.get("view.expandPrimaryItemsByDefault")) {
						this.view.reveal(item, { select: false, expand: true });
						continue;
					}
					await this.view.reveal(item, { select: false, focus: true });
					commands.executeCommand("list.collapse");
				}
				this.view.reveal(this.viewProvider.items[0], {
					select: false,
					focus: true,
				});
			});
		});
	}

	private handleChangeVisibility(visible: boolean): void {
		if (visible) {
			this.memoFetcher.disableBackgroundMode();
			return;
		}
		this.memoFetcher.enableBackgroundMode();
	}

	private async explorerCompleteAll(): Promise<void> {
		const { memoFetcher, viewProvider } = this;
		memoFetcher.suppressForceScan();
		const memoCount = viewProvider.memoCount;
		const items = viewProvider.items;
		const completionDetails = `Are you sure you want to proceed?
			This will mark all ${memoCount} memo${Aux.plural(memoCount)} ${viewProvider.viewType === "File" ? "in" : "under"} ${
			items.length
		} ${viewProvider.viewType.toLowerCase()}${Aux.plural(items)} as completed.`;
		const option = await window.showInformationMessage(
			"Confirm Completion of Memos",
			{ modal: true, detail: completionDetails },
			"Yes",
			"No",
		);
		if (!option || option === "No") {
			memoFetcher.unsuppressForceScan();
			return;
		}
		for (const item of items) await item.completeMemos(this, { noConfirmation: true, _noExtraTasks: true });
		memoFetcher.removeAllMemos();
		viewProvider.items = [];
		viewProvider.refresh();
	}

	private explorerExpandAll() {
		for (const item of this.viewProvider.items) this.view.reveal(item, { select: false, expand: 2 });
	}
}

export class ExplorerViewProvider implements TreeDataProvider<ETItems.ExplorerTreeItemType> {
	items: ETItems.InnerItemType[] = [];
	memoCount = 0;
	viewType: "File" | "Tag";

	private _onDidChangeTreeData: VSEventEmitter<void | undefined | ETItems.ExplorerTreeItemType> = new VSEventEmitter<
		void | undefined | ETItems.ExplorerTreeItemType
	>();
	readonly onDidChangeTreeData: Event<void | undefined | ETItems.ExplorerTreeItemType> =
		this._onDidChangeTreeData.event;

	constructor(private memoFetcher: MemoFetcher) {}

	async init(): Promise<void> {
		await eventEmitter.wait("fetcherInitFinished").then(() => this.reloadItems());
	}

	getTreeItem(element: ETItems.ExplorerTreeItemType): ETItems.ExplorerTreeItemType {
		return element;
	}

	getParent(element: ETItems.ExplorerTreeItemType): ETItems.InnerItemType {
		return element.parent;
	}

	getChildren(element: ETItems.InnerItemType | undefined): ETItems.ExplorerTreeItemType[] {
		if (element) return element.children;
		return this.items;
	}

	removeItems(...items: ETItems.InnerItemType[]): void {
		for (const item of items) {
			if (!this.items.includes(item)) continue;
			const itemIndex = this.items.indexOf(item);
			this.items = this.items.filter((_, i) => i !== itemIndex);
		}
	}

	removeAllItems(): void {
		this.items = [];
	}

	reloadItems(): void {
		this.items = this.getItems();
		this._onDidChangeTreeData.fire();
	}

	refresh(item?: ETItems.ExplorerTreeItemType): void {
		this._onDidChangeTreeData.fire(item);
	}

	private getItems(): ETItems.InnerItemType[] {
		const isFileView = this.viewType === "File";
		const expandPrimaryGroup = configMaid.get("view.expandPrimaryItemsByDefault");
		const expandSecondaryGroup = configMaid.get("view.expandSecondaryItemsByDefault");

		const memos = this.memoFetcher.getMemos();
		const tags = this.memoFetcher.getTags();
		const inner = Aux.groupObjects(memos, isFileView ? "path" : "tag");
		const innerLabels = Object.keys(inner).sort();
		const innerItems = innerLabels.map(
			(label) => new (isFileView ? ETItems.FileItem : ETItems.TagItem)(label, expandPrimaryGroup),
		);
		this.memoCount = memos.length;

		for (let i = 0; i < innerLabels.length; i++) {
			const innerLabel = innerLabels[i];
			const innerItem = innerItems[i];
			if (!isFileView) innerItem.iconPath = new ThemeIcon("bookmark", tags[innerLabel]);

			const halfLeaves = Aux.groupObjects(inner[innerLabel], isFileView ? "tag" : "path");
			const halfLeafLabels = Object.keys(halfLeaves).sort();
			const halfLeafItems = isFileView
				? halfLeafLabels.map(
						(label) => new ETItems.TagItem(label, expandSecondaryGroup, <ETItems.FileItem>innerItem),
				  )
				: halfLeafLabels.map(
						(label) => new ETItems.FileItem(label, expandSecondaryGroup, <ETItems.TagItem>innerItem),
				  );
			innerItem.children = halfLeafItems;

			let childMemoCount = 0;
			for (let j = 0; j < innerItem.children.length; j++) {
				const halfLeafItem = innerItem.children[j];
				const halfLeafLabel = halfLeafLabels[j];
				if (isFileView) halfLeafItem.iconPath = new ThemeIcon("bookmark", tags[halfLeafLabel]);

				let memos = halfLeaves[halfLeafLabel].sort((a, b) => a._offset - b._offset);
				const priority = [];
				const normal = [];
				for (const memo of memos) {
					if (memo.priority !== 0) {
						priority.push(memo);
						continue;
					}
					normal.push(memo);
				}
				memos = priority.sort((a, b) => b.priority - a.priority).concat(normal);
				const tagColor = (<ThemeIcon>(isFileView ? halfLeafItem : innerItem).iconPath).color;
				const maxPriority = Math.max(...memos.map((memo) => (<MemoEntry>memo).priority));
				const memoItems = memos.map(
					(memo) =>
						new ETItems.MemoItem(
							<MemoEntry>memo,
							<ETItems.InnerItemType>halfLeafItem,
							tagColor,
							maxPriority,
						),
				);
				(<ETItems.InnerItemType>halfLeafItem).children = memoItems;
				childMemoCount += memoItems.length;

				halfLeafItem.description = `${memoItems.length} Memo${Aux.plural(memoItems)}`;
				halfLeafItem.tooltip = new MarkdownString(
					`${isFileView ? "Tag: " : "File: *"}${halfLeafItem.label}${isFileView ? "" : "*"} - ${
						memoItems.length
					} $(pencil)`,
					true,
				);
			}

			innerItem.description = `${halfLeafItems.length} ${isFileView ? "Tag" : "File"}${Aux.plural(
				halfLeafItems,
			)} > ${childMemoCount} Memo${Aux.plural(childMemoCount)}`;
			innerItem.tooltip = new MarkdownString(
				`${isFileView ? "File: *" : "Tag: "}${innerItem.label}${isFileView ? "*" : ""} - ${
					halfLeafItems.length
				} ${isFileView ? "$(bookmark)" : "$(file)"} ${childMemoCount} $(pencil)`,
				true,
			);
		}
		return innerItems;
	}
}
