/**
 * xterm.js styles each terminal (font, colours, cell size, scrollbar) by writing CSS into
 * <style> elements inside the terminal. The production Content-Security-Policy blocks
 * inline <style> elements, so those rules never apply and the terminal renders as plain,
 * uncoloured text in the interface font.
 *
 * This mirrors the CSS of those elements into a constructed stylesheet, which the policy
 * permits, and keeps it in sync as xterm rewrites them (resizes, theme or font changes).
 * Returns a function that stops mirroring and removes the stylesheet.
 */
export function mirrorTerminalStyles(root: HTMLElement): () => void {
  const sheet = new CSSStyleSheet();
  let css = '';
  const sync = () => {
    const next = Array.from(root.querySelectorAll('style'), (element) => element.textContent)
      .filter(Boolean)
      .join('\n');
    if (next === css) return;
    css = next;
    sheet.replaceSync(css);
  };
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  return () => {
    observer.disconnect();
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((item) => item !== sheet);
  };
}
