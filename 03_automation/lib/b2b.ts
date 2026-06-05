// Re-export of the shared B2B classifier. The real source of truth now lives in
// packages/shared (@ww/shared/b2b); this thin shim keeps existing
// `./lib/b2b.js` imports working. Edit packages/shared/src/b2b.ts.
export * from "@ww/shared/b2b";
