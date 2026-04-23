// Serve Excalidraw font assets from the vendored public directory
// instead of falling back to esm.sh, eliminating the external CSP requirement.
//
// This side-effect module MUST be imported before @excalidraw/excalidraw
// because Excalidraw resolves font URLs at import time.
//
// The app JS is loaded from /assets/apps/excalidraw/js/, so the fonts dir
// is at /assets/apps/excalidraw/excalidraw/ (public/excalidraw/ in source).

export {}

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string
  }
}

window.EXCALIDRAW_ASSET_PATH = '/assets/apps/excalidraw/excalidraw/'
