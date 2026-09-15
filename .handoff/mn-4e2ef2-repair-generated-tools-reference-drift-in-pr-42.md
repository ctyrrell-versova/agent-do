---
workflow: 2
manna: mn-4e2ef2
track: mn-455a88
source: Diary/_global/2026-09-15.md
base_commit: 1a7b146dddcb7e4ae6f826829883f260ab8ed038
scope: 'Repair generated tools reference drift in PR #42'
inputs:
- Diary/_global/2026-09-15.md
binding: sha256:cc277261c00737eb5f9182456d550a48e4c63fc8baa96a7075d5442aaa82aa2f
---

# Handoff: Repair generated tools reference drift in PR #42

Board state is canonical in `.manna/`. This file is the work order for one item only.

## Claim

```bash
agent-do manna claim mn-4e2ef2
```

## Scope

Repair generated tools reference drift in PR #42

## Inputs

- Diary/_global/2026-09-15.md

## Work order

Regenerate docs/TOOLS.md with the canonical generator, verify the exact diff, and make one additive corrective push.

## Completion

1. Produce the scoped deliverables and verification receipts.
2. Update this handoff only when continuation context changed.
3. Seal changes with `agent-do manna handoff seal mn-4e2ef2`.
4. Commit with `Manna: mn-4e2ef2` and run `agent-do manna done mn-4e2ef2` only after the work is verified.
