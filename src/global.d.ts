/// <reference types="vite/client" />

// Build-time constant injected by vite.config.ts via `define`. The value is
// read from public/version.json at compile time. Used by UpdateButton to
// detect when a new version has been deployed.
declare const __APP_VERSION__: string;
