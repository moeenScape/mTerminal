import type { DesktopApi } from '../../shared/app-info.js';

declare global {
  interface Window {
    readonly mterminal: DesktopApi;
  }
}
