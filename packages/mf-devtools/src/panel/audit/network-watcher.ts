/**
 * Watches network traffic of the inspected window for `mf-manifest.json`
 * fetches and pulls their bodies straight from the DevTools API — no extra
 * round-trip. Each manifest is reported as a `discovered` callback so the
 * audit pipeline can adapt and analyse it.
 *
 * Network events only fire while DevTools is open, so this catches manifests
 * loaded LATE (lazy remotes, route-driven mounts). For manifests fetched
 * before the panel opened, the federation hint poller in the MAIN-world
 * hook installer fills the gap.
 */

const MANIFEST_PATH_RE = /\/mf-manifest\.json(\?.*)?$/

export interface DiscoveredManifest {
  url: string
  raw: unknown
}

export type ManifestListener = (m: DiscoveredManifest) => void

/** Subscribes to network events. Returns an unsubscribe function. */
export function watchManifests(listener: ManifestListener): () => void {
  const onRequestFinished = (
    request: chrome.devtools.network.Request,
  ): void => {
    const url = request.request?.url
    if (!url || !MANIFEST_PATH_RE.test(url)) return
    request.getContent((body, encoding) => {
      if (!body) return
      const text = encoding === 'base64' ? safeAtob(body) : body
      let raw: unknown
      try {
        raw = JSON.parse(text)
      } catch {
        return
      }
      listener({ url, raw })
    })
  }

  chrome.devtools.network.onRequestFinished.addListener(onRequestFinished)
  return () => {
    chrome.devtools.network.onRequestFinished.removeListener(onRequestFinished)
  }
}

function safeAtob(b64: string): string {
  try {
    return atob(b64)
  } catch {
    return ''
  }
}
