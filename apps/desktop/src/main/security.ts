import { pathToFileURL } from 'node:url';
import type { IpcMainInvokeEvent, WebContents } from 'electron';

export function getRendererUrl(
  rendererFile: string,
  developmentUrl: string | undefined,
  isPackaged: boolean,
): string {
  if (isPackaged || !developmentUrl) return pathToFileURL(rendererFile).href;

  const url = new URL(developmentUrl);
  if (
    url.origin !== 'http://127.0.0.1:5173' ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error('The development renderer must use http://127.0.0.1:5173/.');
  }

  return url.href;
}

export function validateAppInfoRequest(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  owner: WebContents,
  rendererUrl: string,
  args: unknown[],
): void {
  if (
    event.sender !== owner ||
    event.senderFrame !== owner.mainFrame ||
    event.senderFrame?.url !== rendererUrl ||
    args.length !== 0
  ) {
    throw new Error('Unauthorized application information request.');
  }
}

export function contentSecurityPolicy(isDevelopment: boolean): string {
  // Vite's React refresh preamble and style updates require inline content in development only.
  const inline = isDevelopment ? " 'unsafe-inline'" : '';
  return [
    "default-src 'self'",
    `script-src 'self'${inline}`,
    `style-src 'self'${inline}`,
    "img-src 'self' data:",
    "font-src 'self'",
    isDevelopment ? "connect-src 'self' ws://127.0.0.1:5173" : "connect-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}
