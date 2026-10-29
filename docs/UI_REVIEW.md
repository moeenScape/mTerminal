# mTerminal UI/UX Review

Review of the desktop app after F31, compared with the Termius Desktop reference. Screens were captured from a local build at 1280×800 and 900×600.

## Summary

The foundations are strong: vault, secret handling, keyboard support, and test coverage. The interface is the weak point. It reads like a web admin panel that contains a terminal. Termius is terminal-first: the session owns the screen, and everything else lives in menus, shortcuts, and side panels.

**Main direction:** give the terminal the screen; move controls into context menus, shortcuts, and panels.

## Critical issues

### 1. Navigation appears twice

The sidebar and the top view tabs both list Hosts, Workspace, and Settings. This wastes space and makes it unclear which one to use.

- **Termius pattern:** the sidebar holds sections (Hosts, Keychain, Snippets, Port Forwarding, Logs). The top bar holds open sessions only.
- **Fix:** remove `ViewTabs` and turn the top strip into the session tab bar.

### 2. The terminal gets about 60% of the window

Five layers of controls (about 165px) sit above the terminal:

1. "Workspace" header with tab and running counts
2. Session tabs
3. Rename / Move left / Move right bar
4. Status line with Copy selection, Paste, Search, Bottom, Select all, Close session
5. "Terminal appearance" section

**Fix:** keep one tab bar, then the terminal edge to edge.

- Rename, close, and move: tab right-click menu. Drag-to-reorder already works.
- Copy, Paste, Search, Select all: terminal right-click menu with shortcuts (Ctrl+Shift+C / V / F).
- Terminal appearance: Settings or a slide-out panel.
- Session status: a small dot on the tab.

### 3. Browser pop-ups are used for key actions

`window.prompt`, `confirm`, and `alert` are used in `HostsView.tsx` for key install, passphrase entry, and key removal. Electron does not support `prompt()`, so the passphrase prompts for **Import key** and **Generate key** probably never appear. Where pop-ups do appear, they don't match the app.

**Fix:** replace them with app `<dialog>` components using the existing `terminal-dialog` pattern.

### 4. Sidebar host count is always 0

`App.tsx` hardcodes the Hosts badge to `0`, while the list shows the real count.

## Hosts screen

- **List is centred in empty space.** `.view-body` uses `place-items: center`, which suits an empty state but not a list. Align the list to the top and use the full width, or use a card grid like Termius.
- **Every row has Connect / Edit / Delete text buttons.** This is noisy, and Delete sits next to Connect.
  - Double-click or Enter connects.
  - An edit icon appears on hover.
  - Delete moves to the right-click menu.
- **Hosts are hard to tell apart.** Add an OS/distro icon or a coloured avatar with initials, and a connected or recently used marker. Show tags as chips instead of "· production · web" text.
- **Show groups as folders** above the hosts instead of only a dropdown filter.
- **Unbalanced header.** "New host" floats in the middle. Put search on the left and a clearly primary **+ New host** button on the right.

## Host form

- **Fields are in the wrong order.** Group, identity, tags, and inherit checkboxes come before name and address. Suggested order:
  1. Address
  2. Label (filled in from the address)
  3. Port and username on one row
  4. Credentials or identity
  5. Optional "Organization" section: group and tags
- **Checkboxes are detached from their labels.** The box sits on the line above its text.
- **Use a side panel instead of a modal** so the host list stays visible while editing, as in Termius.

## Visual system

- **No primary button.** The accent colour is used only for focus rings and underlines. "New host", "Connect", and "Save" look the same as "Cancel". Make each screen's main action a filled accent button.
- **About six button styles.** On Settings, "Export backup" and "Import backup" look like unstyled browser buttons. Define three variants (primary, secondary, ghost) and use only those.
- **Terminal colour theme is incomplete.** Themes set only background, foreground, and cursor, so ANSI colours fall back to xterm defaults. Ship 3–5 complete themes.
- **Font.** Bundle a monospace font such as JetBrains Mono. DejaVu Sans Mono and Consolas are not installed on macOS, so it falls back to a generic font.
- **Vault block takes prime sidebar space** for something rarely used. At 900px it wraps badly ("Set up" splits onto two lines). Move it to a lock icon in the status bar.
- **Status bar shows "Application ready".** Use that space for the active session instead: host, user@address, connection state.
- **Small windows.** Below about 1000px, collapse the sidebar to an icon-only rail.

## Features that make Termius feel like Termius

In priority order:

1. **Quick connect:** type `user@host` in search and press Enter to connect. Biggest win for the least work.
2. **Command palette (Ctrl+K):** connect to hosts, open tabs, run snippets.
3. **Split panes**
4. **SFTP side panel**
5. **Snippets**
6. **Recent connections** on the Hosts screen

## Suggested order of work

1. Merge navigation; make the top bar the session tab bar.
2. Remove the controls above the terminal; add tab and terminal context menus.
3. Replace browser pop-ups with app dialogs; fix the host count.
4. Redesign the host list and host form.
5. Add the button system, complete terminal themes, and a bundled font.
6. Add quick connect and the command palette.
