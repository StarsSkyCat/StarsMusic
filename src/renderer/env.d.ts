import type { DesktopApi } from '../../packages/contracts/src/desktop';

declare global {
  interface Window {
    starsMusic?: DesktopApi;
  }
}
