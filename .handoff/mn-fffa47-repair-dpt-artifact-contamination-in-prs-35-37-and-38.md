---
workflow: 2
manna: mn-fffa47
track: mn-455a88
source: Diary/_global/2026-09-15.md
base_commit: 1a7b146dddcb7e4ae6f826829883f260ab8ed038
scope: 'Repair DPT artifact contamination in PRs #35, #37, and #38'
inputs:
- Diary/_global/2026-09-15.md
binding: sha256:513dd627ada43fb6896d87b932f2c2fdf8899c403cebcb70554ce370f08d671f
---

# Handoff: Repair DPT artifact contamination in PRs #35, #37, and #38

Board state is canonical in `.manna/`. This file is the work order for one item only.

## Claim

```bash
agent-do manna claim mn-fffa47
```

## Scope

Repair DPT artifact contamination in PRs #35, #37, and #38

## Inputs

- Diary/_global/2026-09-15.md

## Work order

Remove the unrelated generated Design Perception Tensor bundle from each existing pull request with one additive cleanup commit, then verify net scope and hosted checks.

## Completion

1. Produce the scoped deliverables and verification receipts.
2. Update this handoff only when continuation context changed.
3. Seal changes with `agent-do manna handoff seal mn-fffa47`.
4. Commit with `Manna: mn-fffa47` and run `agent-do manna done mn-fffa47` only after the work is verified.
