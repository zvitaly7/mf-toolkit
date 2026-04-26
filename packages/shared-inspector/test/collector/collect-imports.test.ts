import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { collectImports } from '../../src/collector/collect-imports.js';
import {
  parseDeclarations,
  isRelativeSpecifier,
  isNodeBuiltin,
  normalizePackageName,
} from '../../src/collector/parse-declarations.js';

const CHECKOUT_SRC = join(import.meta.dirname, '../fixtures/mf-checkout/src');

// ─── parseDeclarations unit tests ────────────────────────────────────────────

describe('parseDeclarations', () => {
  it('extracts default import specifier', () => {
    const decls = parseDeclarations(`import React from 'react';`);
    expect(decls).toContainEqual({ specifier: 'react', kind: 'import' });
  });

  it('extracts named import specifier', () => {
    const decls = parseDeclarations(`import { useState, useEffect } from 'react';`);
    expect(decls).toContainEqual({ specifier: 'react', kind: 'import' });
  });

  it('extracts namespace import specifier', () => {
    const decls = parseDeclarations(`import * as React from 'react';`);
    expect(decls).toContainEqual({ specifier: 'react', kind: 'import' });
  });

  it('extracts side-effect import', () => {
    const decls = parseDeclarations(`import 'reflect-metadata';`);
    expect(decls).toContainEqual({ specifier: 'reflect-metadata', kind: 'import' });
  });

  it('extracts require call', () => {
    const decls = parseDeclarations(`const x = require('lodash');`);
    expect(decls).toContainEqual({ specifier: 'lodash', kind: 'import' });
  });

  it('extracts dynamic import with literal string', () => {
    const decls = parseDeclarations(`const mod = await import('lodash');`);
    expect(decls).toContainEqual({ specifier: 'lodash', kind: 'import' });
  });

  it('skips type-only import: import type { X }', () => {
    const decls = parseDeclarations(`import type { FC } from 'react';`);
    expect(decls).not.toContainEqual(expect.objectContaining({ specifier: 'react', kind: 'import' }));
  });

  it('extracts re-export: export { X } from', () => {
    const decls = parseDeclarations(`export { observer } from 'mobx-react';`);
    expect(decls).toContainEqual({ specifier: 'mobx-react', kind: 'reexport' });
  });

  it('extracts re-export: export * from', () => {
    const decls = parseDeclarations(`export * from 'mobx';`);
    expect(decls).toContainEqual({ specifier: 'mobx', kind: 'reexport' });
  });

  it('skips type-only re-export: export type { X } from', () => {
    const decls = parseDeclarations(`export type { Store } from 'mobx';`);
    expect(decls).not.toContainEqual(expect.objectContaining({ specifier: 'mobx' }));
  });

  it('skips commented-out imports', () => {
    const decls = parseDeclarations(`// import { x } from 'pkg'`);
    expect(decls).toHaveLength(0);
  });

  it('handles multiline imports', () => {
    const decls = parseDeclarations(`
      import {
        useState,
        useEffect,
      } from 'react';
    `);
    expect(decls).toContainEqual({ specifier: 'react', kind: 'import' });
  });
});

// ─── normalizePackageName ─────────────────────────────────────────────────────

describe('normalizePackageName', () => {
  it('normalizes deep import to package name', () => {
    expect(normalizePackageName('lodash/get')).toBe('lodash');
  });

  it('normalizes scoped deep import', () => {
    expect(normalizePackageName('@tanstack/react-query/build/lib')).toBe('@tanstack/react-query');
  });

  it('keeps simple package name as-is', () => {
    expect(normalizePackageName('react')).toBe('react');
  });

  it('keeps scoped package name as-is', () => {
    expect(normalizePackageName('@company/ui-kit')).toBe('@company/ui-kit');
  });
});

// ─── isRelativeSpecifier / isNodeBuiltin ──────────────────────────────────────

describe('isRelativeSpecifier', () => {
  it('returns true for ./ paths', () => expect(isRelativeSpecifier('./shared')).toBe(true));
  it('returns true for ../ paths', () => expect(isRelativeSpecifier('../utils')).toBe(true));
  it('returns false for packages', () => expect(isRelativeSpecifier('react')).toBe(false));
});

describe('isNodeBuiltin', () => {
  it('returns true for node: prefixed builtins', () => expect(isNodeBuiltin('node:fs')).toBe(true));
  it('returns true for unprefixed builtins', () => expect(isNodeBuiltin('path')).toBe(true));
  it('returns false for npm packages', () => expect(isNodeBuiltin('axios')).toBe(false));
});

// ─── collectImports (direct mode, fixture-based) ──────────────────────────────

describe('collectImports — mf-checkout fixture', () => {
  it('finds directly imported packages', async () => {
    const results = await collectImports({ sourceDirs: [CHECKOUT_SRC] });
    const packages = results.map((r) => r.package);

    expect(packages).toContain('react');
    expect(packages).toContain('react-router-dom');
    expect(packages).toContain('axios');
  });

  it('normalizes deep imports to package names', async () => {
    const results = await collectImports({ sourceDirs: [CHECKOUT_SRC] });
    const packages = results.map((r) => r.package);

    expect(packages).toContain('lodash');
    expect(packages).not.toContain('lodash/get');
    expect(packages).toContain('date-fns');
  });

  it('does NOT find packages hidden behind barrel re-exports', async () => {
    const results = await collectImports({ sourceDirs: [CHECKOUT_SRC] });
    const packages = results.map((r) => r.package);

    // mobx and mobx-react are re-exported from src/shared/index.ts
    // direct mode does not follow local module chains
    expect(packages).not.toContain('mobx');
    expect(packages).not.toContain('mobx-react');
  });

  it('skips relative imports', async () => {
    const results = await collectImports({ sourceDirs: [CHECKOUT_SRC] });
    const packages = results.map((r) => r.package);

    expect(packages.every((p) => !p.startsWith('.'))).toBe(true);
  });

  it('skips type-only imports', async () => {
    const results = await collectImports({ sourceDirs: [CHECKOUT_SRC] });
    // app.tsx has "import type { FC } from 'react'" — react should still appear
    // from the non-type import, but this test verifies no duplicates from type imports
    const reactOccurrences = results.filter((r) => r.package === 'react');
    expect(reactOccurrences.length).toBe(1);
  });

  it('marks all results as via: direct', async () => {
    const results = await collectImports({ sourceDirs: [CHECKOUT_SRC] });
    expect(results.every((r) => r.via === 'direct')).toBe(true);
  });

  it('respects ignore option', async () => {
    const results = await collectImports({
      sourceDirs: [CHECKOUT_SRC],
      ignore: ['react', 'react-router-dom'],
    });
    const packages = results.map((r) => r.package);

    expect(packages).not.toContain('react');
    expect(packages).not.toContain('react-router-dom');
    expect(packages).toContain('axios');
  });

  it('respects ignore glob pattern', async () => {
    const results = await collectImports({
      sourceDirs: [CHECKOUT_SRC],
      ignore: ['@tanstack/*'],
    });
    // no @tanstack packages in fixture, but pattern should not crash
    expect(results).toBeDefined();
  });

  it('preserves raw specifier alongside the normalized package name', async () => {
    const results = await collectImports({ sourceDirs: [CHECKOUT_SRC] });
    const lodashDeep = results.find((r) => r.specifier === 'lodash/get');
    expect(lodashDeep).toBeDefined();
    expect(lodashDeep!.package).toBe('lodash');

    const reactRoot = results.find((r) => r.package === 'react');
    expect(reactRoot).toBeDefined();
    // Root imports keep specifier === package
    expect(reactRoot!.specifier).toBe('react');
  });
});
