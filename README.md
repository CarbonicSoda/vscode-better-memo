<h3 align="center" style="margin-bottom: -10px">
	<img src="https://raw.githubusercontent.com/CarbonicSoda/vscode-better-memo/master/media/icon.png" width="100" alt="Better Memo icon">
	<p></p>
	Better Memo for VSCode
</h3>
<h5 align="center">Automatic Comment Curation for Developers</h6>

---

## Features

-   Automated tracking of workspace *Memo*s;
-   Centralized curation in accessible _Memo Explorer_;
-   Streamlined _Memo_ authoring and completion;
-   Simple navigation between *Memo*s;
-   Syntax highlighting to differentiate *Memo*s;
-   _And various other convenient functionalities_;

## Usage Guide

### Syntax of *Memo*s

Comments are only curated by _Better Memo_ if they start with **`MO`** (_case insensitive_).

For example, the following (_line 2_) is a valid _Memo_ in _JS_:

![Memo Example](https://github.com/CarbonicSoda/vscode-better-memo/blob/master/media/usage-guide/memo-example.png?raw=true)

-   **`MO`** tells _Better Memo_ to manage this comment;
-   **`FIX`** is a tag for comment organization (_case insensitive_);
-   **`breaks if *a === b*`** is the comment content;

> _Better Memo_ supports comments in all languages.  
> **e.g.** **`//`** is replaced with **`#`** in _Python_;  
> **e.g.** **`<!-- MO TAG ... -->`** is used in _HTML_;

> A _Memo_ doesn't necessarily need to have content.  
> **e.g.** If some code is left to be cleaned up, you could simply add **`//MO CLEAN`** without any additional text;

> The format of *Memo*s doesn't matter as long as it's valid, _Better Memo_ will format *Memo*s for you automatically.  
> **e.g. `// mO tAg  hi` > `//MO TAG hi`**;

#### New Memo Command

Typing a _Memo_ by hand can be tedious and inefficient. Instead, you can follow these simple steps:

1. Place your cursor on a line.
2. Press **`Alt+M`**.
3. Select/Enter the desired _Memo_ tag in the Quick Pick menu.
4. And... _voilà_! The _Memo_ is instantly inserted, and you can now type in the content.

---

<details>
<summary>Additional Syntax: <i>Memo</i> Priority</summary>
<p></p>

To assign priority to more urgent code actions, you can add an exclamation mark **`!`** before the content.

For example, **`//MO FIX !breaks POST`** would have a higher priority than **`//MO FIX no logs`**.

> As a result, the first one would be listed higher than the second in the _Memo Explorer_. (_introduced in the next section_)

The more exclamation marks you add, the higher the priority of the _Memo_. For instance, **`//MO FIX !!critical failure`** would have an even higher priority than **`//MO FIX !breaks POST`**.

</details>

### The _Memo Explorer_

*Memo*s in the workspace are carefully organized and displayed in an explorer panel, available conveniently in the sidebar, known as the _Memo Explorer_.

Within _Memo Explorer_, two distinct view types are offered, each determining how the *Memo*s are grouped.

**The File View**

![Memo Explorer File View](https://github.com/CarbonicSoda/vscode-better-memo/blob/master/media/usage-guide/memo-explorer-file.png?raw=true)

**The Tag View**

![Memo Explorer Tag View](https://github.com/CarbonicSoda/vscode-better-memo/blob/master/media/usage-guide/memo-explorer-tag.png?raw=true)

-   _File View_: Organizes *Memo*s primarily by containing files;
-   _Tag View_: Organizes *Memo*s primarily by _Memo_ tags;

In each view, the other grouping method is used as the secondary organization layer.

Each tag is assigned a hashed color that will be inherited by all *Memo*s associated with that tag. The color will also serve as the highlighting color for *Memo*s within documents.

> Users can set custom colors for specific tags in the **`better-memo.general.customTags`** setting.  
> **e.g.** The preset tags _FIX_, _TODO_, and _REFACTOR_ are assigned the colors _red_, _green_, and _blue_, respectively.

> The final colors used may differ from the expected colors, this is _intended_ to maintain a higher level of color contrast.

#### Available Actions

##### Actions/Title Bar

The title bar provides the following actions, from left to right:

1. Switch to Tag/File View (**`Ctrl+Shift+V`**);
2. Refresh Explorer (**`Ctrl+R`**);
3. Mark All *Memo*s as Completed;
4. Expand Explorer;
5. Collapse Explorer;

##### Actions/Context

_File Item_:

-   Navigate to File;
-   Mark All *Memo*s in File as Completed;

_Tag Item_:

-   Mark All *Memo*s Under Tag as Completed;

_Memo Item_:

-   **Click** - Navigate to _Memo_;
-   Mark _Memo_ as Completed;

> The behavior of _Better Memo_ when you try to mark _Memo_(s) as completed could be configured in the **`better-memo.actions`** settings section.

> **`Mark Memo(s) as Completed`** from the right-click context-menu will *always* ignore the *`Ask For Confirmation ...`* settings.

### Editor Commands

_Better Memo_ provides several commands to help users work more efficiently in editors.

-   (**`Alt+M`**) New _Memo_ on Line (*[details](#new-memo-command)*);
-   (**`Alt+Shift+M`**) Complete _Memo_(s) Next to Selection(s);

-   (**`Ctrl+Alt+M Ctrl+Alt+<`**) Navigate to Last _Memo_;
-   (**`Ctrl+Alt+M Ctrl+Alt+>`**) Navigate to Next _Memo_;

---
<p>

*&emsp;The palest ink is better than the most retentive memory.*
