---
workflow: 2
manna: mn-4e2ef2
track: mn-455a88
source: Diary/_global/2026-09-15.md
base_commit: 1a7b146dddcb7e4ae6f826829883f260ab8ed038
scope: 'Repair PR #42 docs and non-interactive head contract'
inputs:
- Diary/_global/2026-09-15.md
binding: sha256:df1dac3895d0843d61276f4ab6d4bb25989286287bc51bb4cff6dc3d99790788
---

# Handoff: Repair PR #42 docs and non-interactive head contract

Board state is canonical in `.manna/`. This file is the work order for one item only.

## Claim

```bash
agent-do manna claim mn-4e2ef2
```

## Scope

Repair PR #42 docs and non-interactive head contract

## Inputs

- Diary/_global/2026-09-15.md

## Work order

Regenerate `docs/TOOLS.md` with the canonical generator. Require explicit `--head` so GitHub CLI 2.75.1 cannot prompt to push or fork before pull-request creation. Preserve `--body-file -` standard-input forwarding. Then verify exact net scope, hosted checks, review threads, and the independent audit.

## Completion

1. Produce the scoped deliverables and verification receipts.
2. Update this handoff only when continuation context changed.
3. Seal changes with `agent-do manna handoff seal mn-4e2ef2`.
4. Commit with `Manna: mn-4e2ef2` and run `agent-do manna done mn-4e2ef2` only after the work is verified.
