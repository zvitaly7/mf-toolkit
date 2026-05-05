/**
 * Fetches mf-manifest.json from URLs supplied by the federation snapshot
 * (the `__FEDERATION__` poller in the page-world hook). Used as a fallback
 * for manifests that loaded before DevTools was open and therefore did not
 * fire `network.onRequestFinished`.
 *
 * Runs in the panel context with extension `<all_urls>` permission, so CORS
 * limitations of the inspected page do not apply.
 */

import type { FederationRemoteHint } from '../../shared/protocol.js'

const MANIFEST_FILENAME = 'mf-manifest.json'

export interface FetchedManifest {
  url: string
  raw: unknown
}

/**
 * Resolves the manifest URL for a remote hint. Prefers `manifestUrl` exposed
 * by the runtime; otherwise derives it from the directory of `remoteEntry`.
 */
export function resolveManifestUrl(hint: FederationRemoteHint): string | null {
  if (hint.manifestUrl) return hint.manifestUrl
  if (hint.remoteEntry) {
    try {
      const u = new URL(hint.remoteEntry)
      const dir = u.pathname.replace(/\/[^/]*$/, '/')
      return `${u.origin}${dir}${MANIFEST_FILENAME}`
    } catch {
      return null
    }
  }
  return null
}

export async function fetchManifest(url: string, signal?: AbortSignal): Promise<FetchedManifest | null> {
  try {
    const res = await fetch(url, { signal, credentials: 'omit' })
    if (!res.ok) return null
    const raw = (await res.json()) as unknown
    return { url, raw }
  } catch {
    return null
  }
}
