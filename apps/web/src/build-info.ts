declare const __UNTAMED_BUILD__: { sha: string; dirty: boolean; builtAt: string } | undefined;

/** Commit and build time of this bundle (set by vite.config.ts). `sha: 'unknown'` outside a Vite build or without git. */
export const BUILD: { sha: string; dirty: boolean; builtAt: string } =
  typeof __UNTAMED_BUILD__ !== 'undefined' ? __UNTAMED_BUILD__ : { sha: 'unknown', dirty: false, builtAt: '' };
