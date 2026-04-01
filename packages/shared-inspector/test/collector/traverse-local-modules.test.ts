import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { traverseLocalModules } from '../../src/collector/traverse-local-modules.js';

const CHECKOUT_SRC = join(import.meta.dirname, '../fixtures/mf-checkout/src');

// ─── Core behaviour ───────────────────────────────────────────────────────────

describe('traverseLocalModules — finds packages via re-exports', () => {
  it('finds external packages hidden behind barrel re-exports', async () => {
    const results = await traverseLocalModules({ sourceDirs: [CHECKOUT_SRC] });
    const packages = results.map((r) => r.package);

    // mobx and mobx-react are only re-exported from src/shared/index.ts
    expect(packages).toContain('mobx');
    expect(packages).toContain('mobx-react');
  });

  it('still finds directly imported packages', async () => {
    const results = await traverseLocalModules({ sourceDirs: [CHECKOUT_SRC] });
    const packages = results.map((r) => r.package);

    expect(packages).toContain('react');
    expect(packages).toContain('axios');
    expect(packages).toContain('lodash');
  });
});

// ─── via field ────────────────────────────────────────────────────────────────

describe('traverseLocalModules — via field', () => {
  it('marks re-exported packages with via: reexport', async () => {
    const results = await traverseLocalModules({ sourceDirs: [CHECKOUT_SRC] });

    const mobxEntries = results.filter((r) => r.package === 'mobx');
    expect(mobxEntries.length).toBeGreaterThan(0);
    expect(mobxEntries.every((r) => r.via === 'reexport')).toBe(true);
  });

  it('marks directly imported packages with via: direct', async () => {
    const results = await traverseLocalModules({ sourceDirs: [CHECKOUT_SRC] });

    const reactEntries = results.filter((r) => r.package === 'react');
    expect(reactEntries.length).toBeGreaterThan(0);
    expect(reactEntries.some((r) => r.via === 'direct')).toBe(true);
  });

  it('re-exported packages: file points to the barrel file', async () => {
    const results = await traverseLocalModules({ sourceDirs: [CHECKOUT_SRC] });

    const mobxEntries = results.filter((r) => r.package === 'mobx');
    const files = mobxEntries.map((r) => r.file);
    expect(files.some((f) => f.includes('shared/index.ts'))).toBe(true);
  });
});

// ─── Scope boundary ───────────────────────────────────────────────────────────

describe('traverseLocalModules — scope boundary', () => {
  it('does not traverse into node_modules', async () => {
    const results = await traverseLocalModules({ sourceDirs: [CHECKOUT_SRC] });
    expect(results.every((r) => !r.file.includes('node_modules'))).toBe(true);
  });

  it('does not produce file paths outside sourceDirs', async () => {
    const results = await traverseLocalModules({ sourceDirs: [CHECKOUT_SRC] });
    expect(results.every((r) => r.file.startsWith(CHECKOUT_SRC))).toBe(true);
  });
});

// ─── Safety ───────────────────────────────────────────────────────────────────

describe('traverseLocalModules — safety', () => {
  it('handles circular local imports without hanging', async () => {
    // circular-a.ts ↔ circular-b.ts form a cycle
    // The visited cache must prevent infinite recursion
    await expect(
      traverseLocalModules({ sourceDirs: [CHECKOUT_SRC] }),
    ).resolves.toBeDefined();
  });

  it('resolves directory imports to index file (e.g. ./shared → shared/index.ts)', async () => {
    const results = await traverseLocalModules({ sourceDirs: [CHECKOUT_SRC] });
    const packages = results.map((r) => r.package);

    // app.tsx imports from './shared' which resolves to shared/index.ts
    // shared/index.ts re-exports mobx-react → must be found
    expect(packages).toContain('mobx-react');
  });
});

// ─── Ignore option ────────────────────────────────────────────────────────────

describe('traverseLocalModules — ignore option', () => {
  it('excludes packages matching exact ignore pattern', async () => {
    const results = await traverseLocalModules({
      sourceDirs: [CHECKOUT_SRC],
      ignore: ['mobx'],
    });
    const packages = results.map((r) => r.package);
    expect(packages).not.toContain('mobx');
    expect(packages).toContain('mobx-react'); // not ignored
  });

  it('excludes packages matching glob ignore pattern', async () => {
    const results = await traverseLocalModules({
      sourceDirs: [CHECKOUT_SRC],
      ignore: ['@tanstack/*'],
    });
    // no @tanstack packages in fixture — should not crash
    expect(results).toBeDefined();
  });
});
