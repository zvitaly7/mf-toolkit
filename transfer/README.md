# Transfer: storefront scenario 5 — mf-bridge demo

This branch carries a single patch file generated in a Claude Code cloud
session, intended to be applied to the separate
[mf-storefront-demo](https://github.com/zvitaly7/mf-storefront-demo) repo.

It does not belong on `main` — this branch exists solely to move the patch
out of the cloud container and onto your local machine.

## Apply locally

```bash
# 1. From your local mf-toolkit clone, fetch this branch:
git fetch origin claude/storefront-scenario-5-transfer
git show origin/claude/storefront-scenario-5-transfer:transfer/storefront-scenario-5-mf-bridge.patch \
    > /tmp/scenario-5-mf-bridge.patch

# 2. Switch to your local mf-storefront-demo and apply:
cd /path/to/mf-storefront-demo
git am /tmp/scenario-5-mf-bridge.patch

# 3. Push:
git push origin master

# 4. Optional: delete this transfer branch when done
cd /path/to/mf-toolkit
git push origin --delete claude/storefront-scenario-5-transfer
```
