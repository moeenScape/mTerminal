import type { DesktopApi } from '../../shared/app-info';

declare global {
  interface Window {
    readonly mterminal: DesktopApi;
  }
}
