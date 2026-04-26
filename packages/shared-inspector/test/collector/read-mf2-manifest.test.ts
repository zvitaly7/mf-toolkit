import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isMf2Manifest,
  adaptMf2Manifest,
} from '../../src/collector/read-mf2-manifest.js';

const FIXTURES = join(import.meta.dirname, '../fixtures/mf2-manifests');
const SHELL_JSON = JSON.parse(readFileSync(join(FIXTURES, 'shell.json'), 'utf-8'));
const CHECKOUT_JSON = JSON.parse(readFileSync(join(FIXTURES, 'checkout.json'), 'utf-8'));

// ─── isMf2Manifest ────────────────────────────────────────────────────────────

describe('isMf2Manifest', () => {
  it('accepts a real-shape manifest with metaData and shared', () => {
    expect(isMf2Manifest(SHELL_JSON)).toBe(true);
  });

  it('accepts manifest with shared array but no metaData', () => {
    expect(isMf2Manifest({ name: 'minimal', shared: [] })).toBe(true);
  });

  it('rejects our own ProjectManifest (has schemaVersion)', () => {
    expect(isMf2Manifest({
      schemaVersion: 2,
      generatedAt: '',
      project: { name: 'x', root: '', kind: 'unknown' },
      source: { depth: 'direct', sourceDirs: [], filesScanned: 0 },
      usage: { directPackages: [], resolvedPackages: [], packageDetails: [] },
      shared: { declared: {}, source: 'explicit' },
      versions: { declared: {}, installed: {} },
    })).toBe(false);
  });

  it('rejects null and primitives', () => {
    expect(isMf2Manifest(null)).toBe(false);
    expect(isMf2Manifest(undefined)).toBe(false);
    expect(isMf2Manifest(42)).toBe(false);
    expect(isMf2Manifest('string')).toBe(false);
  });

  it('rejects object missing name', () => {
    expect(isMf2Manifest({ metaData: {}, shared: [] })).toBe(false);
  });

  it('rejects object with name but no MF-shape fields', () => {
    expect(isMf2Manifest({ name: 'foo' })).toBe(false);
  });
});

// ─── adaptMf2Manifest — basic mapping ─────────────────────────────────────────

describe('adaptMf2Manifest — host (shell)', () => {
  const manifest = adaptMf2Manifest(SHELL_JSON);

  it('produces schemaVersion: 2', () => {
    expect(manifest.schemaVersion).toBe(2);
  });

  it('maps name from MF manifest', () => {
    expect(manifest.project.name).toBe('shell');
  });

  it('infers kind=host from metaData.type=app', () => {
    expect(manifest.project.kind).toBe('host');
  });

  it('marks shared.source as extracted-from-plugin', () => {
    expect(manifest.shared.source).toBe('extracted-from-plugin');
  });

  it('declares all locally-shared packages with their config', () => {
    expect(manifest.shared.declared.react).toEqual({
      singleton: true,
      requiredVersion: '^18.2.0',
    });
    expect(manifest.shared.declared['react-dom']).toEqual({
      singleton: true,
      requiredVersion: '^18.2.0',
    });
    expect(manifest.shared.declared.zustand).toEqual({
      singleton: true,
      requiredVersion: '^4.5.0',
    });
  });

  it('populates versions.installed from shared[].version', () => {
    expect(manifest.versions.installed.react).toBe('18.2.0');
    expect(manifest.versions.installed['react-dom']).toBe('18.2.0');
    expect(manifest.versions.installed.zustand).toBe('4.5.0');
  });

  it('sets resolvedPackages to locally-declared shared names', () => {
    expect(manifest.usage.resolvedPackages.sort()).toEqual(['react', 'react-dom', 'zustand']);
  });

  it('produces packageDetails with empty deepImports / files', () => {
    const react = manifest.usage.packageDetails.find((d) => d.package === 'react');
    expect(react).toBeDefined();
    expect(react!.deepImports).toEqual([]);
    expect(react!.files).toEqual([]);
    expect(react!.importCount).toBe(0);
    expect(react!.via).toBe('direct');
  });

  it('reports source.filesScanned as 0 (manifest-derived)', () => {
    expect(manifest.source.filesScanned).toBe(0);
    expect(manifest.source.sourceDirs).toEqual([]);
  });
});

describe('adaptMf2Manifest — remote (checkout)', () => {
  const manifest = adaptMf2Manifest(CHECKOUT_JSON);

  it('infers kind=remote from metaData.type=lib', () => {
    expect(manifest.project.kind).toBe('remote');
  });

  it('preserves singleton flag absence — react-dom in checkout has no singleton', () => {
    expect(manifest.shared.declared['react-dom']).toEqual({
      requiredVersion: '^17.0.2',
    });
  });

  it('preserves shared with no requiredVersion (lodash)', () => {
    expect(manifest.shared.declared.lodash).toEqual({});
  });

  it('still records installed version for shared without requiredVersion', () => {
    expect(manifest.versions.installed.lodash).toBe('4.17.21');
  });
});

// ─── Inheritance filtering ────────────────────────────────────────────────────

describe('adaptMf2Manifest — inherited shared filtering', () => {
  it('drops shared entries declared by another MF (from !== name)', () => {
    const raw = {
      name: 'remote-a',
      metaData: { type: 'lib' },
      shared: [
        { name: 'react', version: '18.2.0', singleton: true, requiredVersion: '^18.0.0', from: 'remote-a' },
        { name: 'react-dom', version: '18.2.0', singleton: true, requiredVersion: '^18.0.0', from: 'host' },
      ],
    };
    const manifest = adaptMf2Manifest(raw);
    expect(manifest.shared.declared.react).toBeDefined();
    expect(manifest.shared.declared['react-dom']).toBeUndefined();
    // installed only tracks locally-declared too
    expect(manifest.versions.installed.react).toBe('18.2.0');
    expect(manifest.versions.installed['react-dom']).toBeUndefined();
  });

  it('treats missing `from` as locally declared', () => {
    const raw = {
      name: 'app',
      metaData: { type: 'app' },
      shared: [{ name: 'react', version: '18.2.0', singleton: true, requiredVersion: '^18.0.0' }],
    };
    const manifest = adaptMf2Manifest(raw);
    expect(manifest.shared.declared.react).toBeDefined();
  });
});

// ─── kind heuristics ──────────────────────────────────────────────────────────

describe('adaptMf2Manifest — kind inference', () => {
  it('falls back to host when remotes present but type missing', () => {
    const raw = {
      name: 'a',
      shared: [],
      remotes: [{ federationContainerName: 'b', entry: 'http://x' }],
      exposes: [],
    };
    expect(adaptMf2Manifest(raw).project.kind).toBe('host');
  });

  it('falls back to remote when only exposes present and type missing', () => {
    const raw = {
      name: 'b',
      shared: [],
      remotes: [],
      exposes: [{ id: 'b:X', name: 'X', path: './X' }],
    };
    expect(adaptMf2Manifest(raw).project.kind).toBe('remote');
  });

  it('returns unknown when both remotes and exposes missing/empty and no type', () => {
    const raw = { name: 'lib', shared: [] };
    expect(adaptMf2Manifest(raw).project.kind).toBe('unknown');
  });
});

// ─── Errors ───────────────────────────────────────────────────────────────────

describe('adaptMf2Manifest — invalid input', () => {
  it('throws on non-MF2 shape', () => {
    expect(() => adaptMf2Manifest({ schemaVersion: 2 })).toThrow(/MF 2.0/);
    expect(() => adaptMf2Manifest(null)).toThrow();
  });
});
