import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/** Build provenance for hardware reports (?profile=1): which commit produced this bundle, and whether it had local edits. */
export function buildInfo(): { sha: string; dirty: boolean; builtAt: string } {
  const builtAt = new Date().toISOString();
  try {
    const sha = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execSync('git status --porcelain --untracked-files=no', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() !== '';
    return { sha, dirty, builtAt };
  } catch {
    return { sha: 'unknown', dirty: false, builtAt };
  }
}

export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  worker: { format: 'es' },
  define: { __UNTAMED_BUILD__: JSON.stringify(buildInfo()) },
});
