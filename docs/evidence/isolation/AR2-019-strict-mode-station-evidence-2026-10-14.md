# AR2-019 strict-mode isolation conformance — station evidence (post-MAINT-002)

**Date:** 2026-10-14
**Run:** `cer_mv7r651y` (strict mode) at main tip `a984ca643155eee5fde50fec4a0b986b73182de2`
**Instrument:** `packages/arena-isolation/test/strict-mode-evidence.ts` (`tsx test/strict-mode-evidence.ts`)
**Station:** TL shared-host gate station — bubblewrap 0.13.0 (built from source per `SUPPLY-CHAIN.md`), full user-namespace isolation, seccomp filters stack, masked-proc procfs strategy.

## Context

This record closes the evidence gap registered in issue #64 (MAINT-002): before the fix, this station's kernel-level uid process count (observed ~170-199; this run calibrated at **256** while only **30** processes are visible in the pid namespace) exceeded `DEFAULT_MAX_PROCESSES = 128`, so bwrap's own `clone()` failed with `EAGAIN` and every sandboxed execution returned a typed non-PASS outcome — the strict-mode instrument recorded EAGAIN failures (fail-closed, never silently converted). PR #65 (MAINT-002, squash `21287c25`) removed the collision: the parent-side `prlimit` prefix no longer carries `--nproc`, and the ceiling is applied child-side after the user-namespace transition, computed ambient-aware.

## Result

**0 FAIL / 0 NOT_SUPPORTED — 3 PASS + 7 DENIED_EXPECTED, exit 0.**

| probe | result |
| --- | --- |
| fs-escape | DENIED (expected — boundary held) |
| net-egress | DENIED (expected — boundary held) |
| pid-visibility | DENIED (expected — boundary held) |
| syscall-filter | DENIED (expected — blocked syscall died SIGSYS) |
| resource-ceil-memory | DENIED (expected — hog killed at ceiling) |
| resource-ceil-process | DENIED (expected — fork bomb hit ceiling) |
| resource-ceil-cpu | DENIED (expected — spin killed at CPU ceiling) |
| secret-hygiene | PASS |
| tenant-binding | PASS (cross-tenant mount refused, fail closed) |
| namespace-conformance | PASS (all six namespaces diverge; uid_map verified) |

Supporting battery at the same SHA on the same station: the full `@arena/isolation` suite (capability, conformance, evidence, provider-port, escape-battery, non-regression, nproc-ceiling) runs **60/60 pass, 0 skipped** — every sandboxed-execution test that failed with EAGAIN at base `73118ac` (16 failures) now executes and passes, including the adversarial escape battery at the REAL OS isolation layer.

## nproc posture (recorded by the instrument)

- `ambient_uid_process_count`: 256 (calibrated via the `prlimit --nproc` ladder over an identical minimal bwrap argv)
- `visible_uid_process_count`: 30 (pidns scan — the honest lower bound)
- `nproc_ceiling`: `{ ambient: 256, margin: 128, floor: 128, hard_ceiling: 4096, computed_ceiling: 384 }`
- posture: `RLIMIT_NPROC` applied child-side (in-sandbox `prlimit` wrapper after the user-namespace transition); the parent-side prefix carries no `--nproc`.

## Full typed record (instrument output)

```json
{
  "record_id": "cer_mv7r651y",
  "created_at": "2026-10-14T06:52:41Z",
  "mode": "strict",
  "battery_head_sha": "a984ca643155eee5fde50fec4a0b986b73182de2",
  "environment": {
    "bwrap": { "version": "bubblewrap 0.13.0", "major": 0, "minor": 13, "path": "/home/z/.local/bin/bwrap" },
    "ambient_uid_process_count": 256,
    "visible_uid_process_count": 30,
    "nproc_ceiling": { "ambient_count": 256, "margin": 128, "floor": 128, "hard_ceiling": 4096, "computed_ceiling": 384 },
    "nproc_posture_detail": "RLIMIT_NPROC applied child-side (in-sandbox prlimit wrapper after the user-namespace transition); the parent-side prlimit prefix carries no --nproc (issue #64: ambient kernel-level uid process count must not gate bwrap's own clone). ambient kernel-level estimate=256 (calibrated via prlimit --nproc ladder over the identical minimal bwrap argv), visible in pidns=30 (lower bound), default ceiling=384 = clamp(ambient + margin 128, floor 128, hard ceiling 4096)"
  },
  "probes": [
    { "name": "fs-escape", "result": "DENIED" },
    { "name": "net-egress", "result": "DENIED" },
    { "name": "pid-visibility", "result": "DENIED" },
    { "name": "syscall-filter", "result": "DENIED" },
    { "name": "resource-ceil-memory", "result": "DENIED" },
    { "name": "resource-ceil-process", "result": "DENIED" },
    { "name": "resource-ceil-cpu", "result": "DENIED" },
    { "name": "secret-hygiene", "result": "PASS" },
    { "name": "tenant-binding", "result": "PASS" },
    { "name": "namespace-conformance", "result": "PASS" }
  ],
  "summary": { "pass": 3, "denied_expected": 7, "not_supported": 0, "fail": 0 }
}
```

## Honest limitations

- The station is a shared-host gate station (the same class the grg_00000008 release-target run needs); the ambient count varies with host load and the ceiling adapts by design — the run records the exact posture it enforced.
- This evidence proves the OS-level boundary behavior and the strict-mode instrument's reproducibility on shared-host stations. It does NOT by itself enable untrusted execution: enablement remains coupled to a recorded owner decision through the AR2-023 instrument, and the production capsule provider approval stays an owner action.
- The port-level tenant-refusal matrix (identical typed 404s for cross-tenant and unknown) is carried by the release-gate battery (`capsule-tenant-refusal.test.ts`), CI-green at this SHA.
