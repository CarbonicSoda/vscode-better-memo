<h3 align="center">
	<img src="https://raw.githubusercontent.com/CarbonicSoda/vscode-better-memo/master/media/icon.png" width="100" alt="Better Memo icon" />
   <p></p>
	Better Memo for VSCode
</h3>
<h4 align="center">Automatic Comment Curation for Developers</h4>

## Features

- Automated tracking of workspace Memos
- Centralized curation in accessible Memo Explorer
- Streamlined Memo authoring and completion
- Simple navigation between Memos
- Syntax highlighting to differentiate Memos
- _And various other convenient functionalities_...

## Usage Guide

### Syntax of Memos

Comments are only curated by Better Memo if they start with `MO`
(case-insensitive).

For example, the following (line 2) is a valid Memo in JS:

![Memo Example](https://github.com/CarbonicSoda/vscode-better-memo/blob/master/media/usage-guide/memo-example.png?raw=true)

- `MO` tells Better Memo to manage this comment;
- `FIX` is a tag for comment organization (_case-insensitive_);
- `breaks if *a === b*` is the comment content;

> Better Memo supports comments in all languages.  
> **e.g.** `//` will be replaced by `#` in Python;  
> **e.g.** `<!-- MO TAG ... -->` is used in HTML; You can configure custom
> comment-delimiters for specific languages **e.g.** ANTLR via
> `better-memo.customLangs`.

> A Memo doesn't necessarily need to have content.  
> **e.g.** If some code is left to be cleaned up, you could simply add
> `//MO CLEAN` without any additional text;

> The format of Memos doesn't matter as long as it's valid, Better Memo will
> format Memos for you automatically.  
> **e.g.** `// mO tAg hi` > `//MO TAG hi`;

### New Memo Command

Typing a Memo by hand can be tedious and inefficient. Instead, you can follow
these simple steps:

1. Place your cursor on a line.
2. Press `Alt+M`.
3. Select/Enter the desired Memo tag in the Quick Pick menu.  
   (you can type in a tag that doesn't exist in the menu, and it will be
   automatically inserted into the Quick Pick)
4. And... _voilà_! The Memo is instantly inserted, and you can now type in the
   content.

> Insertion behavior could be configured in the `better-memo.actions` settings
> section.

---

<details>
<summary>Additional Syntax: Memo Priority</summary>
<p></p>

To assign priority to more urgent code actions, you can add an exclamation mark
`!` before the content.

For example, `//MO FIX !breaks POST` would have a higher priority than
`//MO FIX no logs`.

> As a result, the first one would be listed higher than the second in the Memo
> Explorer. (_introduced in the next section_)

The more exclamation marks you add, the higher the priority of the Memo. For
instance, `//MO FIX !!critical failure` would have an even higher priority than
`//MO FIX !breaks POST`.

</details>

### The Memo Explorer

Memos in the workspace are carefully organized and displayed in an explorer
panel, available conveniently in the sidebar, known as the Memo Explorer.

Within Memo Explorer, two distinct view types are offered, each determining how
the Memos are grouped.

**The Tag View**

![Memo Explorer Tag View](https://github.com/CarbonicSoda/vscode-better-memo/blob/master/media/usage-guide/memo-explorer-tag.png?raw=true)

**The File View**

![Memo Explorer File View](https://github.com/CarbonicSoda/vscode-better-memo/blob/master/media/usage-guide/memo-explorer-file.png?raw=true)

- _Tag View_: Organizes Memos primarily by Memo tags;
- _File View_: Organizes Memos primarily by containing files;

In each view, the other grouping method is used as the secondary organization
layer.

Each tag is assigned a hashed color that will be inherited by all Memos
associated with that tag. The color will also serve as the highlighting color
for Memos within documents.

> Users can set custom colors for specific tags in the
> `better-memo.customTags` setting.  
> **e.g.** The preset tags are _TODO_, _FIX_, _TEST_, _DEV_ and _REFACTOR_.

> The final colors used may differ from the expected colors, this is _intended_
> to maintain a higher level of color contrast.

### Available Actions

#### Actions/Title Bar

The title bar provides the following actions, from left to right:

1. Switch to Tag/File View (`Ctrl+Shift+V`);
2. Refresh Explorer (`Ctrl+R`);
3. Mark All Memos as Completed;
4. Expand Explorer;
5. Collapse Explorer;

#### Actions/Context

_File Item_:

- Navigate to File;
- Mark All Memos in File as Completed;

_Tag Item_:

- Mark All Memos Under Tag as Completed;

_Memo Item_:

- **Click** - Navigate to Memo;
- Mark Memo as Completed;

> The behavior of Better Memo when you try to mark Memo(s) as completed could be
> configured in the `better-memo.actions` settings section.

> `Mark Memo(s) as Completed` from the right-click context-menu will _always_
> ignore the _`Ask For Confirmation ...`_ settings.

## Editor Commands

Better Memo provides several commands to help users work more efficiently in
editors.

- (`Alt+M`) New Memo on Line (_[details](#new-memo-command)_);
- (`Alt+Shift+M`) Complete Memo(s) Next to Selection(s);

- (`Ctrl+Alt+M Ctrl+Alt+<`) Navigate to Last Memo;
- (`Ctrl+Alt+M Ctrl+Alt+>`) Navigate to Next Memo;

> Action behaviors could be configured in the `better-memo.actions` settings
> section.

---

<p>

_&emsp;The palest ink is better than the most retentive memory._
