<h3 align="center">
	<img src="https://raw.githubusercontent.com/CarbonicSoda/vscode-better-memo/master/media/icon.png" width="120" alt="Better Memo icon" />
   <p></p>
	Better Memo for VSCode
</h3>
<h4 align="center">Automatic Comment Curation for Developers</h4>

## Usage

### Syntax

Comments are only curated by Better Memo if they start with `MO`
(case-insensitive).

For example, the following (line 2) is a valid memo in JS:

![Memo](https://github.com/CarbonicSoda/vscode-better-memo/blob/master/media/usage-guide/memo.png?raw=true)

- `MO` tells Better Memo to manage this comment
- `FIX` is a tag for memo organization (case-insensitive)
- `breaks if *a === b*` is the memo content

Content is not a must e.g. if some code is left to be cleaned up, simply put
`//MO CLEAN` without anything additional.

> Better Memo supports all preset languages out of the box. Other languages e.g.
> ANTLR4 can also be supported via `better-memo.customLangs`.

> The format of memos doesn't matter as long as it's valid, Better Memo will
> format memos for you automatically when a tab is closed.

#### Memo Priority

To assign priority to more urgent code actions, you can add `!` before the
content e.g. `//MO FIX !breaks POST` has a higher priority than
`//MO FIX no logs`. The more `!` you add, the higher the priority.

Priority memos will be pinned on top in the Memo Explorer (introduced in the
next section) with distinct appearance.

### New Memo

Typing a memo by hand can be tedious and inefficient. Instead, you can utilize a
command:

1. Place your cursor on a line.
2. Press `Alt+M`.
3. Select/Enter the desired Memo tag in the Quick Pick menu.  
   (you can enter a tag that is absent in the menu and it will be inserted into
   the Quick Pick)
4. And... _voilà_! A memo is instantly inserted for you to type in the content.

> To complete a memo, press `Alt+Shift+M`.

> All commands mentioned supports multiple cursors.

### The Memo Explorer

Memos in the workspace are carefully organized and displayed in an explorer
panel, available conveniently in the sidebar.

The Memo Explorer offers two distinct view types deciding how memos are grouped.

#### The Tag View

![Tag View](https://github.com/CarbonicSoda/vscode-better-memo/blob/master/media/usage-guide/tag-view.png?raw=true)

#### The File View

![File View](https://github.com/CarbonicSoda/vscode-better-memo/blob/master/media/usage-guide/file-view.png?raw=true)

> The memo nearest to the active document selection will be focused in the
> editor.

Each memo tag is assigned a hashed color, which will also serve as the
highlighting color for document decorations.

#### Available Actions

##### Title Bar

1. Switch to Tag/File View (`Ctrl+Shift+V`)
2. Refresh Explorer (`Ctrl+R`)
3. Complete All Memos
4. Toggle Fold

##### Context

File Item

- Navigate to File
- Complete All Memos

Tag Item

- Complete All Memos

Memo Item

- **Click** - Navigate to Memo;
- Complete Memo;

### Commands

Better Memo provides several utility commands to help users work more
efficiently:

- (`Alt+M`) New Memo on Line ([details](#new-memo))
- (`Alt+Shift+M`) Complete Memo Near Cursor

> The above commands support multiple cursors.

- (`Ctrl+Alt+M` + `Ctrl+Alt+<`) Navigate to Prev Memo
- (`Ctrl+Alt+M` + `Ctrl+Alt+>`) Navigate to Next Memo

---

_&emsp;The palest ink is better than the most retentive memory._
