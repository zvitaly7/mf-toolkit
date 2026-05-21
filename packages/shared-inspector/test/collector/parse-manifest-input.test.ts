import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseManifestInput } from '../../src/browser.js';
import type { ProjectManifest } from '../../src/types.js';

const FIXTURES = join(import.meta.dirname, '../fixtures/mf2-manifests');
const SHELL_JSON = JSON.parse(readFileSync(join(FIXTURES, 'shell.json'), 'utf-8'));

function makeProjectManifest(): ProjectManifest {
  return {
    schemaVersion: 2,
    generatedAt: '2026-05-21T00:00:00.000Z',
    project: { name: 'checkout', root: '/repo/checkout', kind: 'remote' },
    source: { depth: 'local-graph', sourceDirs: ['./src'], filesScanned: 12 },
    usage: {
      directPackages: ['react'],
      resolvedPackages: ['react'],
      packageDetails: [{
        package: 'react',
        importCount: 3,
        files: ['src/App.tsx'],
        via: 'direct',
        deepImports: [],
      }],
    },
    shared: {
      declared: { react: { singleton: true, requiredVersion: '^18.2.0' } },
      source: 'explicit',
    },
    versions: {
      declared: { react: '^18.2.0' },
      installed: { react: '18.2.0' },
    },
  };
}

describe('parseManifestInput', () => {
  it('adapts an MF 2.0 manifest into a ProjectManifest', () => {
    const manifest = parseManifestInput(SHELL_JSON);

    expect(manifest?.schemaVersion).toBe(2);
    expect(manifest?.project.name).toBe('shell');
    expect(manifest?.shared.declared.react).toEqual({
      singleton: true,
      requiredVersion: '^18.2.0',
    });
  });

  it('returns a native ProjectManifest unchanged', () => {
    const original = makeProjectManifest();

    expect(parseManifestInput(original)).toBe(original);
  });

  it('returns null for unsupported JSON shapes', () => {
    expect(parseManifestInput(null)).toBeNull();
    expect(parseManifestInput({ name: 'not-mf-enough' })).toBeNull();
    expect(parseManifestInput({ schemaVersion: 1 })).toBeNull();
  });
});
