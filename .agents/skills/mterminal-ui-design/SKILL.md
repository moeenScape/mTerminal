---
name: mterminal-ui-design
description: "Design, implement, or review mTerminal React interfaces against its Termius-style desktop direction, including terminal layouts, host management, SFTP, and accessibility. Use for visual or interaction changes in apps/desktop."
---

# mTerminal UI Design

## Establish the screen and reference

Read the repository [README](../../../README.md#interface-direction), the relevant feature in [the roadmap](../../../DEVELOPMENT_ROADMAP.md), and existing renderer components/styles before editing. Treat current files as authoritative; the application may still be an empty scaffold. Keep future server and shared packages empty unless the requested work needs them.

Termius Desktop is the visual and workflow reference. Use supplied references first, then the existing material under `docs/termius/` or official product screenshots when needed. Inspect a relevant screen rather than inventing a generic dashboard. Use mTerminal branding and original assets.

## Compose a working desktop interface

- Preserve the navigation, host view, session tab strip, and terminal workspace hierarchy. A terminal session should receive the useful screen area; avoid oversized cards, decorative charts, and marketing-style spacing.
- Use dark surfaces, subtle borders, clear selected/hover/focus states, restrained accent color, readable interface text, and monospace terminal output. Extract recurring colors, spacing, and typography into the existing styling system rather than scattering new values.
- Give searchable host lists clear group/tag organization and explicit connection state. Do not rely on color alone to distinguish production, selection, or failure.
- Keep terminal tabs readable, split-pane handles usable, and active input destination obvious. Broadcast mode needs persistent recipient visibility. Keep terminal focus from being stolen by background updates.
- For SFTP, make local and remote destinations unmistakable. Show transfer progress, failures, cancellation, and overwrite choices next to the affected operation.
- Implement relevant empty, loading, disconnected, and error states. Use preview data only in an explicitly requested mockup; do not present fake connections or no-op buttons as implemented features.

Reuse existing components, styling, and icons. Add a component abstraction when repeated behavior or accessibility warrants it. Add no UI framework solely to recreate a small control.

## Preserve desktop usability

Use semantic controls and labels for icon-only actions. Support keyboard navigation, visible focus, contrast, and context-menu alternatives. Respect Ctrl/Cmd differences and platform window controls. Destructive confirmation must identify the affected host, file, or session.

Check small and large window sizes and increased display/text scaling. Keep panes from overlapping controls. Resize xterm.js and its underlying session together after layout or font changes; avoid clipping the terminal or replacing it with styled static text.

## Validate the result

Run available renderer checks appropriate to the change. If the app can run, inspect the actual screen or screenshots, compare its hierarchy with the reference, and exercise the requested interaction, keyboard focus, resizing, and relevant failure state. A passing build does not prove visual quality.

If the toolchain or target platform is unavailable, state what could not be inspected rather than claiming a visual or cross-platform pass. Update only the roadmap items actually completed. Report the screen behavior changed and any remaining limitations.
