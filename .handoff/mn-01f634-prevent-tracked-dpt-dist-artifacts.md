---
workflow: 2
manna: mn-01f634
track: mn-455a88
source: Diary/_global/2026-09-15.md
base_commit: 1a7b146dddcb7e4ae6f826829883f260ab8ed038
scope: Prevent tracked DPT dist artifacts
inputs:
- Diary/_global/2026-09-15.md
binding: sha256:9bc97e65f10d3a76123af625e1fa51da7b9d35ad2850dc6e9b5f359df402cc13
---

# Handoff: Prevent tracked DPT dist artifacts

Board state is canonical in `.manna/`. This file is the work order for one item only.

## Claim

```bash
agent-do manna claim mn-01f634
```

## Scope

Prevent tracked DPT dist artifacts

## Inputs

- Diary/_global/2026-09-15.md

## Work order

Add the correct ignore rule and a regression gate so a generated tools/agent-dpt/dist bundle cannot silently enter future pull requests.

## Completion

1. Produce the scoped deliverables and verification receipts.
2. Update this handoff only when continuation context changed.
3. Seal changes with `agent-do manna handoff seal mn-01f634`.
4. Commit with `Manna: mn-01f634` and run `agent-do manna done mn-01f634` only after the work is verified.
