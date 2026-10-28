import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron';
import { describe, expect, it } from 'vitest';
import {
  allowRendererReload,
  contentSecurityPolicy,
  getRendererUrl,
  validateAppInfoRequest,
} from '../../src/main/security.js';

const rendererFile = resolve('out/renderer/index.html');
const rendererUrl = pathToFileURL(rendererFile).href;

function requestContext(url = rendererUrl) {
  const frame = { url } as WebFrameMain;
  const owner = { mainFrame: frame } as WebContents;
  const event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'> = {
    sender: owner,
    senderFrame: frame,
  };
  return { owner, event };
}

describe('renderer location', () => {
  it('loads the built file when no development server is configured', () => {
    expect(getRendererUrl(rendererFile, undefined, false)).toBe(rendererUrl);
  });

  it('ignores the development URL in packaged applications', () => {
    expect(getRendererUrl(rendererFile, 'https://untrusted.example/', true)).toBe(rendererUrl);
  });

  it('normalizes the fixed loopback development address', () => {
    expect(getRendererUrl(rendererFile, 'http://127.0.0.1:5173', false)).toBe(
      'http://127.0.0.1:5173/',
    );
  });

  it.each([
    'https://untrusted.example/',
    'http://127.0.0.1:5173.untrusted.example/',
    'http://127.0.0.1:5174/',
    'http://127.0.0.1:5173/other',
    'http://127.0.0.1:5173/?redirect=elsewhere',
    'http://127.0.0.1:5173/#other',
    'http://user:password@127.0.0.1:5173/',
    'file:///tmp/untrusted.html',
  ])('rejects an unexpected development URL: %s', (url) => {
    expect(() => getRendererUrl(rendererFile, url, false)).toThrow();
  });
});

describe('app information IPC authorization', () => {
  it('allows a payload-free request from the owning main frame', () => {
    const { owner, event } = requestContext();
    expect(() => validateAppInfoRequest(event, owner, rendererUrl, [])).not.toThrow();
  });

  it('rejects a different window even if it has the same URL', () => {
    const { owner } = requestContext();
    const { event } = requestContext();
    expect(() => validateAppInfoRequest(event, owner, rendererUrl, [])).toThrow('Unauthorized');
  });

  it('rejects a subframe even if its URL matches', () => {
    const { owner, event } = requestContext();
    const subframeEvent = { ...event, senderFrame: { url: rendererUrl } as WebFrameMain };
    expect(() => validateAppInfoRequest(subframeEvent, owner, rendererUrl, [])).toThrow(
      'Unauthorized',
    );
  });

  it('rejects requests when the frame is gone', () => {
    const { owner, event } = requestContext();
    expect(() =>
      validateAppInfoRequest({ ...event, senderFrame: null }, owner, rendererUrl, []),
    ).toThrow('Unauthorized');
  });

  it('rejects the owning frame after its URL changes', () => {
    const { owner, event } = requestContext('https://untrusted.example/');
    expect(() => validateAppInfoRequest(event, owner, rendererUrl, [])).toThrow('Unauthorized');
  });

  it('rejects unexpected arguments rather than ignoring them', () => {
    const { owner, event } = requestContext();
    expect(() =>
      validateAppInfoRequest(event, owner, rendererUrl, [{ command: 'anything' }]),
    ).toThrow('Unauthorized');
  });
});

describe('content security policy', () => {
  it('disallows inline code and outgoing connections in production', () => {
    const policy = contentSecurityPolicy(false);
    expect(policy).not.toContain('unsafe-inline');
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("frame-src 'none'");
  });

  it('allows the local HMR connection without wildcard network access', () => {
    const policy = contentSecurityPolicy(true);
    expect(policy).toContain('ws://127.0.0.1:5173');
    expect(policy).not.toContain('*');
    expect(policy).not.toContain('unsafe-eval');
  });
});

describe('renderer reload policy', () => {
  it.each([
    [rendererUrl, true, true],
    [rendererUrl, false, false],
    ['https://example.com/', true, false],
    [rendererUrl + '?redirect=https://example.com', true, false],
  ])('checks destination %s and main-frame ownership %s', (url, main, allowed) => {
    expect(allowRendererReload(url as string, main as boolean, rendererUrl)).toBe(allowed);
  });
});
