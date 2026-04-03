# Session context: implement mf-storefront-demo

## What this session should do

Implement the demo repository `zvitaly7/mf-storefront-demo` from scratch based on the
detailed plan in `zvitaly7/mf-toolkit` →
`docs/shared-inspector-demo-plan.md` (branch `claude/shared-inspector-demo`).

**Both repositories are in scope for this session.**

---

## What already exists

- `zvitaly7/mf-toolkit` — the main package repo. Contains the full implementation plan at
  `docs/shared-inspector-demo-plan.md`. Do NOT modify `main` branch of mf-toolkit yet —
  the README link to the demo will be added only after the demo repo is complete.
- `zvitaly7/mf-storefront-demo` — empty repo, needs to be fully implemented.

---

## What to build

An e-commerce microfrontend demo with three apps:

| App | Role | Key deps |
|---|---|---|
| `shell` | Host | react 18.3.1, react-dom, react-router-dom 6.22.3, zustand 4.5.2 |
| `catalog` | Remote | react 18.3.1, react-dom, react-router-dom 6.22.3, lodash 4.17.21 |
| `checkout` | Remote | react 18.3.1, react-dom, react-router-dom 6.22.3, zustand 4.5.2 |

Each app must be self-contained: own `package.json`, `tsconfig.json`,
`webpack.config.js`, `shared-config.json`, `.github/workflows/build.yml`,
and just enough source files to justify the dependency tree.

---

## Three git branches / scenarios

### `main` — Scenario 1: Healthy

All shared configs correctly aligned. Expected scores:
- `shell`: 100/100
- `catalog`: 92/100 (lodash candidate — intentionally accepted)
- `checkout`: 100/100
- federation: 100/100

**catalog/shared-config.json:**
```json
{
  "react":            { "singleton": true, "requiredVersion": "^18.3.1" },
  "react-dom":        { "singleton": true, "requiredVersion": "^18.3.1" },
  "react-router-dom": { "singleton": true, "requiredVersion": "^6.22.3" }
}
```

**shell/shared-config.json** and **checkout/shared-config.json** additionally include:
```json
"zustand": { "singleton": true, "requiredVersion": "^4.5.2" }
```

### `scenario/drift` — Scenario 2: Per-app drift

Changes applied on top of `main`:

**catalog/shared-config.json** (stale config):
```json
{
  "react":            { "singleton": true, "requiredVersion": "^17.0.2" },
  "react-dom":        { "singleton": true, "requiredVersion": "^17.0.2" },
  "react-router-dom": { "singleton": true, "requiredVersion": "^6.22.3" },
  "zustand":          { "requiredVersion": "^4.5.2" },
  "date-fns":         {}
}
```
catalog/package.json also gets `"zustand": "4.5.2"` and `"date-fns": "3.6.0"` added.

**checkout/shared-config.json** (eager risk):
```json
{
  "react":            { "singleton": true, "requiredVersion": "^18.3.1" },
  "react-dom":        { "singleton": true, "requiredVersion": "^18.3.1" },
  "react-router-dom": { "eager": true, "requiredVersion": "^6.22.3" },
  "zustand":          { "singleton": true, "requiredVersion": "^4.5.2" }
}
```

Expected scores: catalog 38/100 CRITICAL, checkout 92/100, shell 100/100, federation 100/100.

### `scenario/federation-issues` — Scenario 3: Cross-MF conflicts

Branch from `main` (not from drift). Changes to shared configs only:

**shell/shared-config.json**: add `"lodash": {}`
**catalog/shared-config.json**: change react-router-dom to `"^6.8.0"`
**checkout/shared-config.json**: change zustand to `{ "requiredVersion": "^4.5.2" }` (no singleton)
**checkout/src/Cart.tsx**: add `import { format } from 'date-fns'`

Expected: per-app scores look clean (97/92/92), federation 61/100 RISKY with 4 findings.

---

## Key source files

### catalog — barrel pattern (critical for depth demo)

**catalog/src/utils/format.ts**
```typescript
import truncate from 'lodash/truncate';
import capitalize from 'lodash/capitalize';
export const formatProductTitle = (title: string) =>
  capitalize(truncate(title, { length: 48 }));
```

**catalog/src/utils/index.ts** (barrel)
```typescript
export { formatProductTitle } from './format';
```

**catalog/src/ProductList.tsx** — must import via barrel, not lodash directly:
```typescript
import { formatProductTitle } from './utils';
```

### shell — zustand auth store
```typescript
// shell/src/store/authStore.ts
import { create } from 'zustand';
interface AuthStore { user: string | null; setUser: (u: string | null) => void; }
export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}));
```

### checkout — zustand cart store
```typescript
// checkout/src/store/cartStore.ts
import { create } from 'zustand';
interface CartStore { items: string[]; add: (item: string) => void; }
export const useCartStore = create<CartStore>((set) => ({
  items: [],
  add: (item) => set((s) => ({ items: [...s.items, item] })),
}));
```

---

## Scripts to create

### scripts/inspect-all.sh
```bash
#!/usr/bin/env bash
set -e
WORKSPACE_PKGS="@mf-storefront/*"
FAIL_ON="${FAIL_ON:-none}"

echo "=== shell ==="
(cd shell && npx @mf-toolkit/shared-inspector \
  --source src --shared shared-config.json \
  --workspace-packages "$WORKSPACE_PKGS" \
  --write-manifest --output-dir . --fail-on "$FAIL_ON")

echo "=== catalog ==="
(cd catalog && npx @mf-toolkit/shared-inspector \
  --source src --shared shared-config.json \
  --workspace-packages "$WORKSPACE_PKGS" \
  --write-manifest --output-dir . --fail-on "$FAIL_ON")

echo "=== checkout ==="
(cd checkout && npx @mf-toolkit/shared-inspector \
  --source src --shared shared-config.json \
  --workspace-packages "$WORKSPACE_PKGS" \
  --write-manifest --output-dir . --fail-on "$FAIL_ON")

echo "=== federation ==="
npx @mf-toolkit/shared-inspector federation \
  shell/project-manifest.json \
  catalog/project-manifest.json \
  checkout/project-manifest.json
```

### scripts/inspect-polyrepo.sh
```bash
#!/usr/bin/env bash
set -e
MANIFESTS_DIR="$(pwd)/.manifests"
mkdir -p "$MANIFESTS_DIR"

for app in shell catalog checkout; do
  echo "=== $app (isolated) ==="
  (cd "$app" && npm ci --silent && npx @mf-toolkit/shared-inspector \
    --source src --shared shared-config.json \
    --write-manifest --output-dir "$MANIFESTS_DIR" --name "$app")
done

echo "=== federation (from collected manifests) ==="
npx @mf-toolkit/shared-inspector federation \
  "$MANIFESTS_DIR"/shell-project-manifest.json \
  "$MANIFESTS_DIR"/catalog-project-manifest.json \
  "$MANIFESTS_DIR"/checkout-project-manifest.json

rm -rf "$MANIFESTS_DIR"
```

### scripts/federation-gate.ts
```typescript
import { readFileSync } from 'fs';
import {
  analyzeFederation, scoreFederationReport, formatFederationReport,
} from '@mf-toolkit/shared-inspector';
import type { ProjectManifest } from '@mf-toolkit/shared-inspector';

const THRESHOLD = 70;
const manifests: ProjectManifest[] = [
  'shell/project-manifest.json',
  'catalog/project-manifest.json',
  'checkout/project-manifest.json',
].map((p) => JSON.parse(readFileSync(p, 'utf-8')));

const report = analyzeFederation(manifests);
const { score, label, high, medium, low } = scoreFederationReport(report);
console.log(formatFederationReport(report));
console.log(`\nFederation score: ${score}/100 (${label}) — HIGH:${high} MED:${medium} LOW:${low}`);
if (score < THRESHOLD) { console.error(`✗ Below threshold ${THRESHOLD}`); process.exit(1); }
console.log(`✓ OK`);
```

---

## Per-app CI workflow (identical for all three apps)

```yaml
# shell/.github/workflows/build.yml  (same for catalog and checkout)
name: Build and inspect
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run build   # MfSharedInspectorPlugin writes project-manifest.json
      - uses: actions/upload-artifact@v4
        with:
          name: manifest-${{ github.event.repository.name }}
          path: project-manifest.json
          retention-days: 7
```

---

## Implementation order

1. Root `package.json`, `README.md`, `.gitignore` → commit as initial commit on `main`
2. `shell/` — package.json, tsconfig, webpack.config, shared-config, source files, workflow
3. `catalog/` — same + barrel pattern in utils/
4. `checkout/` — same + cartStore.ts
5. `scripts/` — inspect-all.sh, inspect-polyrepo.sh, federation-gate.ts
6. Verify healthy scenario produces expected scores → tag `v1-healthy`
7. Branch `scenario/drift` → apply catalog + checkout changes → verify scores → tag `v2-drift`
8. Branch `scenario/federation-issues` from main → apply changes → verify → tag `v3-federation-issues`
9. After demo repo is complete: add `## Demo` section with link to mf-toolkit README (main branch)

---

## Full plan reference

Detailed explanation of every scenario, expected CLI output verbatim, score calculations,
and detection category alignment table:
`zvitaly7/mf-toolkit` → `docs/shared-inspector-demo-plan.md` (branch `claude/shared-inspector-demo`)
