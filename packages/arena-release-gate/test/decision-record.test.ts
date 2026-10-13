import assert from "node:assert/strict";
import test from "node:test";
import { validateDecisionRecord, canonicalJson } from "../src/contract.js";
import {
  limitedScopeRecord,
  notGoHoldRecord,
  productionGoRecord,
  ar2015Recomputation,
  allGreenRecomputation,
} from "./decision-fixtures.js";

/**
 * AR2-023 — 决策记录 schema 向量 + 决策类一致性验收（issue #55）：
 * - 正向向量：一致的受限范围 / NOT_GO_HOLD / PRODUCTION_GO 记录通过；
 * - 负向向量（fail-closed）：错误决策类、缺证据 SHA、空复审条件、未知门判定、
 *   未知字段、错误 schema 版本、篡改机器决策、摘要/门行不一致、悬空依据、
 *   自引用修订等全部失败；
 * - 决策类 vs 重算一致性：三类各自的「一致/不一致」夹具。
 */

function tamper(record: unknown, mutate: (draft: Record<string, unknown>) => void): unknown {
  const draft = structuredClone(record) as Record<string, unknown>;
  mutate(draft);
  return draft;
}

function expectInvalid(candidate: unknown, ...fragments: string[]): void {
  const validation = validateDecisionRecord(candidate);
  assert.equal(validation.kind, "INVALID", `expected INVALID for ${JSON.stringify(fragments)}`);
  if (validation.kind === "INVALID") {
    const joined = validation.issues.map((issue) => issue.rule).join(" | ");
    for (const fragment of fragments) {
      assert.ok(joined.includes(fragment), `expected issue containing "${fragment}", got: ${joined}`);
    }
  }
}

test("positive vector: a consistent LIMITED_SCOPE_GO record over the AR2-015 basis validates", () => {
  const validation = validateDecisionRecord(limitedScopeRecord());
  assert.equal(validation.kind, "VALID");
  if (validation.kind === "VALID") {
    assert.equal(validation.record.decision_class, "LIMITED_SCOPE_GO");
    assert.equal(validation.record.schema_version, "RDR1.0");
    assert.deepEqual(validation.record.scope.platforms, ["linux"]);
    assert.equal(validation.record.gate_recomputation.machine_decision.decision, "NOT_GO");
  }
});

test("positive vector: a consistent NOT_GO_HOLD record with blockers listed as OPEN risks validates", () => {
  const validation = validateDecisionRecord(notGoHoldRecord());
  assert.equal(validation.kind, "VALID");
});

test("positive vector: a consistent PRODUCTION_GO record over an all-green recomputation validates", () => {
  const validation = validateDecisionRecord(productionGoRecord());
  assert.equal(validation.kind, "VALID");
});

test("negative vector: a wrong decision class fails closed", () => {
  expectInvalid(tamper(limitedScopeRecord(), (d) => {
    d.decision_class = "GO";
  }), "decision_class");
  expectInvalid(tamper(limitedScopeRecord(), (d) => {
    d.decision_class = "PRODUCTION GO";
  }), "decision_class");
  expectInvalid(tamper(limitedScopeRecord(), (d) => {
    d.decision_class = "limited_scope_go";
  }), "decision_class");
});

test("negative vector: a missing or malformed evidence SHA fails closed", () => {
  expectInvalid(tamper(limitedScopeRecord(), (d) => {
    const manifest = d.evidence_manifest as Array<Record<string, unknown>>;
    manifest[0]!.sha = "";
  }), "sha");
  expectInvalid(tamper(limitedScopeRecord(), (d) => {
    const manifest = d.evidence_manifest as Array<Record<string, unknown>>;
    manifest[1]!.sha = "7d117f1"; // short SHA is not an exact SHA
  }), "sha");
});

test("negative vector: empty review/expiry conditions fail for GO classes", () => {
  expectInvalid(tamper(limitedScopeRecord(), (d) => {
    d.review_conditions = [];
  }), "requires non-empty review/expiry conditions");
  expectInvalid(tamper(productionGoRecord(), (d) => {
    d.review_conditions = [];
  }), "requires non-empty review/expiry conditions");
  // 仅事件类条件（无日期）也不满足 —— GO 类必须有带日期的到期/复审条件。
  expectInvalid(tamper(limitedScopeRecord(), (d) => {
    d.review_conditions = [{ kind: "re_review_on_event", description: "x", date: null }];
  }), "dated expiry/re-review condition");
});

test("negative vector: an unknown gate verdict inside the attached recomputation fails closed", () => {
  expectInvalid(tamper(limitedScopeRecord(), (d) => {
    const recomputation = d.gate_recomputation as Record<string, unknown>;
    const entries = recomputation.entries as Array<Record<string, unknown>>;
    entries[0]!.verdict = "GREEN";
  }), "verdict");
  expectInvalid(tamper(limitedScopeRecord(), (d) => {
    const recomputation = d.gate_recomputation as Record<string, unknown>;
    const entries = recomputation.entries as Array<Record<string, unknown>>;
    entries[0]!.verdict = "PASSED";
  }), "verdict");
});

test("negative vector: unknown fields, wrong schema version and a missing signer block fail closed", () => {
  expectInvalid(tamper(limitedScopeRecord(), (d) => {
    d.silent_enablement = true;
  }), "Unrecognized key");
  expectInvalid(tamper(limitedScopeRecord(), (d) => {
    d.schema_version = "RDR0.9";
  }), "schema_version");
  expectInvalid(tamper(limitedScopeRecord(), (d) => {
    const signer = d.signer as Record<string, unknown>;
    delete signer.github_identity;
  }), "github_identity");
  expectInvalid(tamper(limitedScopeRecord(), (d) => {
    d.decision_date = "2026-10-14";
  }), "decision_date");
});

test("negative vector: a tampered machine decision no longer matching the recomputed rows fails closed", () => {
  expectInvalid(tamper(limitedScopeRecord(), (d) => {
    const recomputation = d.gate_recomputation as Record<string, unknown>;
    const decision = recomputation.machine_decision as Record<string, unknown>;
    decision.decision = "GO";
    delete decision.reason;
    delete decision.detail;
  }), "does not match decideRelease");
});

test("negative vector: flat summary disagreeing with the recomputed row fails closed", () => {
  expectInvalid(tamper(limitedScopeRecord(), (d) => {
    const recomputation = d.gate_recomputation as Record<string, unknown>;
    const entries = recomputation.entries as Array<Record<string, unknown>>;
    const blocked = entries.find((entry) => entry.verdict === "BLOCKED");
    blocked!.verdict = "PASS";
  }), "disagrees with its recomputed row");
});

test("negative vector: a basis reference outside the record evidence manifest fails closed", () => {
  expectInvalid(tamper(limitedScopeRecord(), (d) => {
    const recomputation = d.gate_recomputation as Record<string, unknown>;
    const entries = recomputation.entries as Array<Record<string, unknown>>;
    const basis = entries[0]!.basis as Array<Record<string, unknown>>;
    basis[0]!.entry_id = "evd_99999999";
  }), "not in the record evidence manifest");
});

test("negative vector: duplicate platforms and a self-referencing amendment fail closed", () => {
  expectInvalid(tamper(limitedScopeRecord(), (d) => {
    const scope = d.scope as Record<string, unknown>;
    scope.platforms = ["linux", "linux"];
  }), "platforms contains duplicates");
  expectInvalid(tamper(limitedScopeRecord(), (d) => {
    d.supersedes = { decision_id: "rdr_00000001", reason: "self reference" };
  }), "cannot supersede itself");
});

test("class consistency: PRODUCTION_GO is invalid over the recorded NOT_GO basis", () => {
  expectInvalid(tamper(productionGoRecord(), (d) => {
    d.gate_recomputation = ar2015Recomputation();
  }), "requires all core gates green");
});

test("class consistency: PRODUCTION_GO with scrapers in scope requires the G8 extension gate to PASS", () => {
  const scopeOverrides = {
    untrusted_execution: "enabled_expert_and_scraper",
    isolation_mode: "approved_os_level_provider",
  };
  // G8 BLOCKED（AR2-015 记录）⇒ 无效。
  expectInvalid(
    tamper(productionGoRecord(), (d) => {
      Object.assign(d.scope as Record<string, unknown>, scopeOverrides);
      d.gate_recomputation = ar2015Recomputation();
    }),
    "requires all core gates green",
  );
  // 全绿（含 G8 PASS）⇒ 有效。
  const valid = tamper(productionGoRecord(), (d) => {
    Object.assign(d.scope as Record<string, unknown>, scopeOverrides);
  });
  assert.equal(validateDecisionRecord(valid).kind, "VALID");
});

test("class consistency: enabling untrusted execution requires the approved OS-level isolation mode", () => {
  expectInvalid(tamper(productionGoRecord(), (d) => {
    const scope = d.scope as Record<string, unknown>;
    scope.untrusted_execution = "enabled_expert";
  }), "approved OS-level isolation");
});

test("class consistency: live-money scope requires the enablement precondition and the recorded G4 risk", () => {
  const base = tamper(productionGoRecord(), (d) => {
    const scope = d.scope as Record<string, unknown>;
    scope.finance_mode = "live_mode";
  });
  expectInvalid(base, "enablement_precondition");
  const withPrecondition = tamper(base as Record<string, unknown>, (d) => {
    d.review_conditions = [
      { kind: "enablement_precondition", description: "separately registered WO after this decision", date: null },
      { kind: "expires_on", description: "expiry", date: "2027-01-31" },
    ];
  });
  expectInvalid(withPrecondition, "linked to G4");
  const withRisk = tamper(withPrecondition as Record<string, unknown>, (d) => {
    d.residual_risks = [
      {
        risk_id: "rsk_00000009",
        description: "live-money commercial/legal readiness recorded",
        severity: "high",
        linked_gates: ["grg_00000010"],
        disposition: "ACCEPTED_WITH_CONTROLS",
        mitigation: "recorded commercial/legal readiness basis",
      },
    ];
  });
  assert.equal(validateDecisionRecord(withRisk).kind, "VALID");
});

test("class consistency: LIMITED_SCOPE_GO boundaries are enforced (linux-only, test-mode, untrusted disabled, synthetic basis)", () => {
  expectInvalid(tamper(limitedScopeRecord(), (d) => {
    const scope = d.scope as Record<string, unknown>;
    scope.platforms = ["linux", "macos"];
  }), "linux-only");
  expectInvalid(tamper(limitedScopeRecord(), (d) => {
    const scope = d.scope as Record<string, unknown>;
    scope.finance_mode = "live_mode";
  }), "test-mode finance");
  expectInvalid(tamper(limitedScopeRecord(), (d) => {
    const scope = d.scope as Record<string, unknown>;
    scope.untrusted_execution = "enabled_expert";
  }), "untrusted execution disabled");
  expectInvalid(tamper(limitedScopeRecord(), (d) => {
    const scope = d.scope as Record<string, unknown>;
    scope.isolation_mode = "approved_os_level_provider";
  }), "synthetic-provider basis");
});

test("class consistency: a FAILed core gate is never scope-excusable under LIMITED_SCOPE_GO", () => {
  expectInvalid(
    tamper(limitedScopeRecord(), (d) => {
      d.gate_recomputation = failOneCoreGate("grg_00000002", "FAIL");
    }),
    "FAILed",
  );
});

test("class consistency: a BLOCKED core gate outside the excusable set is invalid under LIMITED_SCOPE_GO", () => {
  expectInvalid(
    tamper(limitedScopeRecord(), (d) => {
      d.gate_recomputation = failOneCoreGate("grg_00000001", "BLOCKED");
    }),
    "not excusable under the limited scope",
  );
});

test("class consistency: scope-excused gates must be recorded as owner-accepted residual risks", () => {
  expectInvalid(
    tamper(limitedScopeRecord(), (d) => {
      d.residual_risks = (d.residual_risks as Array<Record<string, unknown>>).filter(
        (risk) => !(risk.linked_gates as string[]).includes("grg_00000013"),
      );
    }),
    "owner-accepted residual risk",
  );
});

test("class consistency: unresolved critical/high findings block a LIMITED_SCOPE_GO (only blocked_core_gate is excusable)", () => {
  expectInvalid(
    tamper(limitedScopeRecord(), (d) => {
      d.gate_recomputation = withUnresolvedCritical();
    }),
    "cannot excuse machine reason unresolved_critical_or_high",
  );
});

test("class consistency: NOT_GO_HOLD requires every open blocker listed as an OPEN residual risk", () => {
  expectInvalid(
    tamper(notGoHoldRecord(), (d) => {
      d.residual_risks = (d.residual_risks as Array<Record<string, unknown>>).filter(
        (risk) => !(risk.linked_gates as string[]).includes("grg_00000013"),
      );
    }),
    "must be listed as an OPEN residual risk",
  );
  // 处置不是 OPEN（例如已接受）也不满足 hold 的「未决阻断」语义。
  expectInvalid(
    tamper(notGoHoldRecord(), (d) => {
      const risks = d.residual_risks as Array<Record<string, unknown>>;
      const risk = risks.find((item) => (item.linked_gates as string[]).includes("grg_00000008"));
      risk!.disposition = "ACCEPTED_WITH_CONTROLS";
      risk!.mitigation = "controls recorded";
    }),
    "must be listed as an OPEN residual risk",
  );
});

test("class consistency: an all-green recomputation also supports LIMITED_SCOPE_GO (no excused gates needed)", () => {
  const validation = validateDecisionRecord(
    tamper(limitedScopeRecord(), (d) => {
      d.gate_recomputation = allGreenRecomputation();
      // 证据清单必须与附着重算的依据一致（同一证据文档 + 同一 SHA）。
      d.evidence_manifest = [
        {
          entry_id: "evd_00000001",
          kind: "evidence_doc",
          link: "docs/evidence/release/hypothetical-future-gate-report.md",
          sha: "b".repeat(40),
          description: "hypothetical all-green evidence fixture (synthetic SHA — machinery test only)",
        },
      ];
      d.residual_risks = [
        {
          risk_id: "rsk_00000004",
          description: "demo-auth identity adapter seam recorded",
          severity: "medium",
          linked_gates: ["grg_00000005"],
          disposition: "ACCEPTED_WITH_CONTROLS",
          mitigation: "bounded to recorded demo tenants",
        },
      ];
    }),
  );
  assert.equal(validation.kind, "VALID");
});

/** 把一个 core 门改为 FAIL/BLOCKED 并重算机器决策（保持其余结构诚实）。 */
function failOneCoreGate(gateId: string, verdict: "FAIL" | "BLOCKED") {
  const recomputation = structuredClone(ar2015Recomputation()) as Record<string, unknown>;
  const entries = recomputation.entries as Array<Record<string, unknown>>;
  const entry = entries.find((item) => item.gate_id === gateId);
  assert.ok(entry !== undefined);
  entry.verdict = verdict;
  const row = entry.recomputed_row as Record<string, unknown>;
  row.classification = verdict;
  const decision = recomputation.machine_decision as Record<string, unknown>;
  decision.reason = verdict === "FAIL" ? "failed_core_gate" : "blocked_core_gate";
  decision.detail = `${gateId} (${row.section}): ${row.requirement}`;
  return recomputation;
}

/** 注入一个未决 critical 发现（触发 unresolved_critical_or_high 机器原因）。 */
function withUnresolvedCritical() {
  const recomputation = structuredClone(ar2015Recomputation()) as Record<string, unknown>;
  const entries = recomputation.entries as Array<Record<string, unknown>>;
  const entry = entries.find((item) => item.gate_id === "grg_00000001");
  assert.ok(entry !== undefined);
  const finding = {
    finding_id: "fnr_00000099",
    severity: "critical",
    description: "fixture: unresolved critical finding",
    resolution: "unresolved",
    owner_acceptance: null,
  };
  entry.findings = [finding];
  const row = entry.recomputed_row as Record<string, unknown>;
  row.findings = [finding];
  const decision = recomputation.machine_decision as Record<string, unknown>;
  decision.reason = "unresolved_critical_or_high";
  decision.blocking_findings = 1;
  decision.detail = "grg_00000001/fnr_00000099: fixture: unresolved critical finding";
  return recomputation;
}

test("canonicalJson is key-order independent and array-order preserving (deterministic comparisons)", () => {
  assert.equal(canonicalJson({ b: 1, a: [2, 1] }), canonicalJson({ a: [2, 1], b: 1 }));
  assert.notEqual(canonicalJson({ a: [1, 2] }), canonicalJson({ a: [2, 1] }));
});
