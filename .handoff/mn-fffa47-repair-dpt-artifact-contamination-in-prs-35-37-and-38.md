---
workflow: 2
manna: mn-fffa47
track: mn-455a88
source: Diary/_global/2026-09-15.md
base_commit: 1a7b146dddcb7e4ae6f826829883f260ab8ed038
scope: 'Repair PRs #35, #37, and #38 scope and heartbeat safety'
inputs:
- Diary/_global/2026-09-15.md
binding: sha256:e9fd285f52d92a6ece06b292dede87319328bc711f5d72caf3d4591a0a6a989c
---

# Handoff: Repair PRs #35, #37, and #38 scope and heartbeat safety

Board state is canonical in `.manna/`. This file is the work order for one item only.

## Claim

```bash
agent-do manna claim mn-fffa47
```

## Scope

Repair PRs #35, #37, and #38 scope and heartbeat safety

## Inputs

- Diary/_global/2026-09-15.md

## Work order

Remove the unrelated generated Design Perception Tensor bundle from each existing pull request. Close the verified PR #37 heartbeat redaction and contract gaps found by independent audit. Then verify exact net scope, hosted checks, review threads, and the independent audit for all three pull requests.

## Completion

1. Produce the scoped deliverables and verification receipts.
2. Update this handoff only when continuation context changed.
3. Seal changes with `agent-do manna handoff seal mn-fffa47`.
4. Commit with `Manna: mn-fffa47` and run `agent-do manna done mn-fffa47` only after the work is verified.
