import type { AnalysisOptions } from '../types.js';

// ─── Built-in lists ───────────────────────────────────────────────────────────

/**
 * Packages that are never flagged as unused by default.
 * React is consumed transitively by JSX Transform (no explicit import needed).
 */
export const DEFAULT_ALWAYS_SHARED: readonly string[] = [
  'react',
  'react-dom',
];

/**
 * Packages with global state — should be shared with singleton: true.
 * Duplicating these causes runtime errors (e.g. "Invalid hook call") or
 * silent state isolation across microfrontends.
 */
export const SINGLETON_RISK_PACKAGES: readonly string[] = [
  // Frameworks
  'react',
  'react-dom',
  'vue',
  // Routing
  'react-router',
  'react-router-dom',
  'vue-router',
  // State — observable / flux
  'mobx',
  'mobx-react',
  'mobx-react-lite',
  'redux',
  'react-redux',
  '@reduxjs/toolkit',
  // State — hooks-based
  'zustand',
  'jotai',
  'recoil',
  // Data fetching — client cache instances
  '@tanstack/react-query',
  'swr',
  '@apollo/client',
  'urql',
  // Styling — theme context + class-name caches
  'styled-components',
  '@emotion/react',
  '@emotion/styled',
];

/**
 * Packages that are typically shared across microfrontends.
 * Used for the candidates heuristic — presence in this list + not in shared config = suggestion.
 */
export const SHARE_CANDIDATE_PACKAGES: readonly string[] = [
  // Frameworks
  'react',
  'react-dom',
  'vue',
  'svelte',
  'solid-js',
  // Routing
  'react-router',
  'react-router-dom',
  'vue-router',
  // State management
  'mobx',
  'mobx-react',
  'mobx-react-lite',
  'redux',
  'react-redux',
  '@reduxjs/toolkit',
  'zustand',
  'jotai',
  'recoil',
  // Data fetching
  '@tanstack/react-query',
  'swr',
  '@apollo/client',
  'urql',
  // Styling
  'styled-components',
  '@emotion/react',
  '@emotion/styled',
];

// ─── Resolved policy ─────────────────────────────────────────────────────────

export interface ResolvedPolicy {
  alwaysShared: Set<string>;
  singletonRisks: Set<string>;
  shareCandidates: Set<string>;
}

/**
 * Merge built-in policy with user-supplied AnalysisOptions.
 * User lists extend (not replace) the built-in lists.
 */
export function mergePolicy(options?: AnalysisOptions): ResolvedPolicy {
  const alwaysShared = new Set<string>(DEFAULT_ALWAYS_SHARED);
  const singletonRisks = new Set<string>(SINGLETON_RISK_PACKAGES);
  const shareCandidates = new Set<string>(SHARE_CANDIDATE_PACKAGES);

  if (options?.alwaysShared) {
    for (const pkg of options.alwaysShared) alwaysShared.add(pkg);
  }
  if (options?.additionalSingletonRisks) {
    for (const pkg of options.additionalSingletonRisks) singletonRisks.add(pkg);
  }
  if (options?.additionalCandidates) {
    for (const pkg of options.additionalCandidates) shareCandidates.add(pkg);
  }

  return { alwaysShared, singletonRisks, shareCandidates };
}
