import { execSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { buildInfo } from '../../apps/web/vite.config';
import { BUILD } from '../../apps/web/src/build-info';

// Hardware reports (?profile=1) must name the commit they measured (PLATFORM_HANDOVER.md §5).
describe('build provenance', () => {
  it('records the checked-out commit and whether tracked files were modified', () => {
    const info = buildInfo();
    expect(info.sha).toBe(execSync('git rev-parse HEAD').toString().trim());
    expect(info.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof info.dirty).toBe('boolean');
    expect(Number.isNaN(Date.parse(info.builtAt))).toBe(false);
  });
  it('falls back to an explicit unknown outside a Vite build', () => {
    expect(BUILD.sha).toBe('unknown');
  });
});
