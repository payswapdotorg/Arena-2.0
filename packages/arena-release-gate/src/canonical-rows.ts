import type { GateRow } from "./gate-registry.js";

/**
 * AR2-015 — 规范门行（G0–G8 分类数据；gate-report.ts 渲染、
 * docs/evidence/release/AR2-015-gate-report-2026-10-11.md 的类型化来源）。
 *
 * 纪律：行数据只引用 CI battery 真实执行的命令与其结果（证据类 = 命令
 * 本身可复跑）；SHA 在生成报告时注入（= 运行这些套件的分支 HEAD）。分类
 * 是诚实的：OS 级 capsule 隔离 BLOCKED（合成 provider 不是隔离证据）、
 * 跨平台安装 BLOCKED、可访问性 E2E 覆盖 BLOCKED —— 因此核心生产发布
 * 决策是 NOT_GO（受限范围内运行：不可信执行禁用 + test-mode 财务）。
 * G8 是独立扩展门（extension scope）：未实现不阻断核心发布，但它是
 * 扩展自身发布的硬门。
 */

export interface GateReportMeta {
  /** 运行被引用套件的分支 HEAD（证据 SHA）。 */
  head_sha: string;
  /** 基线 main SHA（dispatch 记录）。 */
  base_sha: string;
  /** CI 运行环境描述。 */
  environment: string;
}

const CI = "CI battery (ubuntu-latest, Node 24, pnpm 10.33.2)";

function row(input: {
  gate_id: string;
  section: GateRow["section"];
  scope: GateRow["scope"];
  requirement: string;
  classification: GateRow["classification"];
  command: string;
  result: string;
  limitations: string;
  findings?: GateRow["findings"];
  waiver_authorization?: GateRow["waiver_authorization"];
}): GateRow {
  return {
    gate_id: input.gate_id,
    section: input.section,
    scope: input.scope,
    requirement: input.requirement,
    classification: input.classification,
    evidence: {
      evidence_class: "automated_unit_suite",
      command: input.command,
      environment: CI,
      sha: "",
      result: input.result,
      limitations: input.limitations,
      reviewer: "arena-tl",
    },
    waiver_authorization: input.waiver_authorization ?? null,
    findings: input.findings ?? [],
  };
}

/** 组装规范的 G0–G8 分类行（SHA 由 meta 注入 —— 证据指向运行套件的树）。 */
export function buildCanonicalGateRows(meta: GateReportMeta): readonly GateRow[] {
  const withSha = (r: GateRow): GateRow => ({
    ...r,
    evidence: { ...r.evidence, sha: meta.head_sha },
  });
  const rows: GateRow[] = [
    // ── G0 ──
    row({
      gate_id: "grg_00000001",
      section: "G0-fork-baseline",
      scope: "core",
      requirement:
        "Fresh clone/install + clean battery on Linux; upstream base pinned; Apache-2.0/NOTICE preserved",
      classification: "PASS",
      command:
        "pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm architecture:check",
      result:
        "green on every accepted WO PR (AR2-000 baseline report: PASS WITH EXISTING FAILURES, all pre-existing failures inventoried); CI battery required on main since 2026-10-10",
      limitations: "ubuntu-latest/CI sandbox only; upstream base 29628c9 pinned in PROJECT-STATE",
    }),
    row({
      gate_id: "grg_00000002",
      section: "G0-fork-baseline",
      scope: "core",
      requirement: "macOS/Windows install proof (required before any cross-platform release claim)",
      classification: "BLOCKED",
      command: "(not executed — no macOS/Windows runner in the current battery)",
      result: "Linux-only install evidence at AR2-000 baseline; cross-platform proofs outstanding",
      limitations:
        "blocks cross-platform release claims, not the Linux-scoped core posture; scheduled before any such claim",
      findings: [
        {
          finding_id: "fnr_00000001",
          severity: "medium",
          description: "macOS/Windows fresh-install proof not yet executed",
          resolution: "unresolved",
          owner_acceptance: null,
        },
      ],
    }),
    // ── G1 ──
    row({
      gate_id: "grg_00000003",
      section: "G1-contracts-architecture",
      scope: "core",
      requirement:
        "Runtime schema validation; state machines reject invalid transitions; immutable history; no cycles; public exports only",
      classification: "PASS",
      command:
        "pnpm --filter @arena/contracts test-equivalent: tsx --test test/vectors.test.ts test/transitions.test.ts test/completeness.test.ts test/ownership.test.ts test/contracts.test.ts",
      result:
        "104/104 contract vectors/transitions/ownership green (CF1.0 frozen; strict schemas reject unknown fields)",
      limitations: "contract-unit scope; integration drift covered by per-package suites",
    }),
    row({
      gate_id: "grg_00000004",
      section: "G1-contracts-architecture",
      scope: "core",
      requirement: "Dependency direction guard; architecture policy; no deep imports",
      classification: "PASS",
      command: "pnpm architecture:check",
      result:
        "0 violations across all registered arena modules (roots/publicEntrypoints/owner fences)",
      limitations: "static policy check; runtime wiring audited per WO acceptance",
    }),
    // ── G2 ──
    row({
      gate_id: "grg_00000005",
      section: "G2-security-tenant-boundaries",
      scope: "core",
      requirement:
        "Tenant-scoped object access: cross-tenant ID guessing fails closed and is indistinguishable from not-found; tenant list isolation; server-derived tenant context",
      classification: "PASS",
      command:
        "tsx --test test/cross-tenant.test.ts (packages/arena-release-gate; spawns a REAL arena-api process)",
      result:
        "full guessing sweep on escalation/timeline/result/payment-status/command routes returns identical typed 404s for cross-tenant and non-existent IDs (no existence oracle); cross-tenant list is empty; request-body tenant fields schema-rejected",
      limitations:
        "DEMO auth adapter surface (deterministic token registry); production identity adapter is a declared future seam",
    }),
    row({
      gate_id: "grg_00000006",
      section: "G2-security-tenant-boundaries",
      scope: "core",
      requirement:
        "Webhooks reject forged signatures, stale timestamps, wrong schemes, malformed headers; duplicate/replayed deliveries apply exactly once",
      classification: "PASS",
      command:
        "tsx --test test/webhook-signature.test.ts (packages/arena-release-gate; REAL HTTP receiver)",
      result:
        "valid delivery APPLIED once; tampered body/wrong secret/old-header-new-body ⇒ BAD_SIGNATURE 401; stale ⇒ STALE_TIMESTAMP 401; wrong scheme/malformed ⇒ 400; verbatim replay and attempt-bumped retry ⇒ DUPLICATE with effect still applied once (delivery-id dedup)",
      limitations:
        "HMAC-SHA256 v1 scheme, 300s default tolerance; receiver-side apply-once is consumer contract",
    }),
    row({
      gate_id: "grg_00000007",
      section: "G2-security-tenant-boundaries",
      scope: "core",
      requirement:
        "Untrusted page/API/evidence content is data, never policy: prompt-injection payloads cannot alter validation outcomes, bindings or proof decisions",
      classification: "PASS",
      command:
        "tsx --test test/prompt-injection-as-data.test.ts (packages/arena-release-gate; REAL @arena/evidence store + evaluateProof)",
      result:
        "injection-laden storage refs accepted/stored verbatim as data with outcomes identical to benign twins; binding always compared against the server-derived ExpectedBinding (payload text irrelevant); caller/self-evaluation assertions never flip P0/P2 decisions",
      limitations:
        "fixture corpus of representative injection payloads; adversarial breadth is unbounded by nature",
    }),
    row({
      gate_id: "grg_00000008",
      section: "G2-security-tenant-boundaries",
      scope: "core",
      requirement:
        "Capsule filesystem/process/network/credential boundaries tested at the ACTUAL OS/runtime isolation layer; capsule tenant mismatch fails closed and is indistinguishable from not-found",
      classification: "BLOCKED",
      command:
        "tsx --test test/capsule-tenant-refusal.test.ts (packages/arena-release-gate; REAL CapsuleProviderPort via SyntheticLocalProvider)",
      result:
        "tenant-refusal matrix PASS on the real port surface (cross-tenant/unknown ⇒ indistinguishable ARENA_CAPSULE_UNAVAILABLE; escalation/attempt mismatch ⇒ ARENA_TENANT_MISMATCH; all four port ops refuse; teardown verified) — BUT the synthetic provider is explicitly NOT OS-level isolation evidence; production capsule provider remains NOT APPROVED / NOT VERIFIED",
      limitations:
        "untrusted expert/scraper execution stays DISABLED; production release NOT_GO until a real isolation provider is approved and evidenced (M4)",
    }),
    // ── G3 ──
    row({
      gate_id: "grg_00000009",
      section: "G3-durability-idempotency-resilience",
      scope: "core",
      requirement:
        "Same-key replay vs same-key/different-digest conflict; two-instance admission; leases/fencing; SIGKILL crash+restart recovery; outbox exactly-once; no correctness in process memory only",
      classification: "PASS",
      command:
        "tsx --test test/durable.test.ts test/durable-edge.test.ts (arena-api) + test/durable.test.ts test/jobs.test.ts (arena-persistence) + test/two-instance-recovery.test.ts (arena-harness)",
      result:
        "durable sqlite/WAL suites green; two REAL API processes on one durable file with cross-instance canonical state; process-group SIGKILL mid-flight ⇒ restart with zero state loss and exactly-once outbox delivery",
      limitations:
        "node:sqlite reference engine; no production-scale DB/hosting claim without its own ADR",
    }),
    // ── G4 ──
    row({
      gate_id: "grg_00000010",
      section: "G4-proof-payments",
      scope: "core",
      requirement:
        "Failed/inconclusive proof never pays; proof task-bound; duplicate payment commands produce one ledger + one provider operation; live-money unavailable without production configuration",
      classification: "PASS",
      command:
        "tsx --test test/evidence.test.ts test/proof-evaluator.test.ts (arena-evidence) + test/ledger.test.ts test/payment-flow.test.ts (arena-payment) + test/vertical-p0.test.ts test/next-expert.test.ts (arena-harness)",
      result:
        "P0 baseline-fail⇒intervention-pass with exactly ONE test payout; failed first attempt never pays; P2 INCONCLUSIVE payout gate NOT_READY (disclosed, never bypassed); duplicate release/ledger replay proven single-operation; live payment mode DISABLED",
      limitations:
        "InMemoryTestProvider test-mode settlement; live-money readiness is a separate commercial/legal gate",
    }),
    // ── G5 ──
    row({
      gate_id: "grg_00000011",
      section: "G5-expert-arena",
      scope: "core",
      requirement:
        "P2 requires predeclared rubric + independent quorum; self-evaluation never a vote; conflict exclusion; adjudication thresholds; immutable candidates",
      classification: "PASS",
      command:
        "tsx --test test/machines.test.ts test/candidate.test.ts test/review-assignment.test.ts test/rubric-quorum.test.ts test/adjudication-validation.test.ts (arena-expert-arena) + test/p2-review.test.ts (arena-harness)",
      result:
        "frozen EA machines green; P2 fail-closed proof routed to independent review with never-a-vote self-evals, conflict-checked reviewers, quorum and adjudication; round outcome payment-bound",
      limitations:
        "in-memory reference registries behind frozen ports (durable wiring at composition root)",
    }),
    // ── G6 ──
    row({
      gate_id: "grg_00000012",
      section: "G6-product-end-to-end",
      scope: "core",
      requirement:
        "Real external client → real API → expert attempt → validator → result; demo mode visibly labelled; second-expert path with attribution",
      classification: "PASS",
      command:
        "tsx --test test/vertical-p0.test.ts test/next-expert.test.ts test/p2-review.test.ts test/two-instance-recovery.test.ts (arena-harness) + test/e2e-real-api.test.ts (arena-workbench)",
      result:
        "four REAL-process acceptance profiles green (exactly-one payout; signed webhooks apply-once; stable-ID trace; failed-attempt routing with attribution; P2 independent review; SIGKILL recovery); workbench binds the real API with labelled demo preset",
      limitations: "integration claims within tested scope only — see report header",
    }),
    row({
      gate_id: "grg_00000013",
      section: "G6-product-end-to-end",
      scope: "core",
      requirement:
        "Responsive, keyboard-accessible E2E coverage across requester/expert/reviewer/developer/operations flows",
      classification: "BLOCKED",
      command:
        "tsx --test test/workbench.test.ts test/render.test.tsx test/expert-review.test.tsx (arena-workbench)",
      result:
        "workbench render/review suites green for the cockpit and reviewer decks; full keyboard/screen-reader E2E across all five flows is not yet evidenced",
      limitations:
        "recorded as a release limitation; accessibility hardening remains open work before customer-facing claims",
      findings: [
        {
          finding_id: "fnr_00000002",
          severity: "medium",
          description:
            "accessibility E2E coverage (keyboard/screen-reader across all flows) not yet evidenced",
          resolution: "unresolved",
          owner_acceptance: null,
        },
      ],
    }),
    // ── G7 ──
    row({
      gate_id: "grg_00000014",
      section: "G7-observability-operations",
      scope: "core",
      requirement:
        "Quota exhaustion visible and fail-closed; readiness distinguishes API/dependency/queue lag; privacy-safe logs; retention drift detection; runbooks for the required scenarios",
      classification: "PASS",
      command:
        "tsx --test test/health-capacity.test.ts test/custodian.test.ts test/observability-retention.test.ts (arena-ops)",
      result:
        "fail-closed readiness probes; typed QUOTA_EXHAUSTED; queue-lag gauge; retained dead letters; capsule teardown-drift custodian driving the REAL provider port; sha256 tenant pseudonyms + frozen-enum metrics; retention with zero deletion authority; RUNBOOKS.md RB-1..RB-8",
      limitations:
        "observability reference implementation; production metric backend wiring is deployment scope",
    }),
    // ── G8（独立扩展门）──
    row({
      gate_id: "grg_00000015",
      section: "G8-capability-acquisition",
      scope: "extension",
      requirement:
        "Capability-acquisition/scraper execution gates: versioned acquisition contracts, provider routing modes, immutable scraper builds, real-isolation execution only, SSRF/egress controls, rights/provenance, before/after capability evaluation",
      classification: "BLOCKED",
      command: "(not implemented — AR2-016/017/018 remain planned and not dispatched)",
      result:
        "ACR-0002 merged (PR #35 e3091fe) with canonical spec; zero extension runtime exists; this row is the separate extension gate and does not block the core release decision; it becomes a hard gate for the extension release and for any first-production scope that includes scrapers",
      limitations:
        "extension planned post-core; TL re-checks worker capacity/dependencies/SHAs before any dispatch",
    }),
  ];
  return rows.map(withSha);
}
