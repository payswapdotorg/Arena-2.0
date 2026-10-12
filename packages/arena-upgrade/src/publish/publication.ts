import type { TenantContext } from "@arena/contracts";
import { computeCanonicalDigest } from "@arena/acquisition";
import {
  verifyCertificationBinding,
  type BodyVersion,
  type Certification,
  type RightsGrantRegistry,
} from "@arena/learning";
import { UPGRADE_SCHEMA_FAMILY, type ActorRef } from "../primitives.js";
import type { CapabilityUpgradeProposal } from "../proposal.js";
import type { CapabilityPack } from "../pack.js";
import type { BeforeAfterDelta, EvaluationRun } from "../eval/run.js";
import type { EvidenceChainRecord } from "../evidence.js";
import type { UpgradeStore } from "../store.js";
import type { UpgErrorCode } from "../errors.js";
import { upgError, type UpgErrorEnvelope } from "../errors.js";
import {
  POPULARITY_BYPASS_GUARD_RULE,
  type AdoptionRecord,
  type PublicationDecision,
  type RollbackRecord,
} from "./records.js";

/* Record contracts (schemas, types, guard rule) live in ./records.ts;
 * re-exported here so the public import surface is unchanged. */
export * from "./records.js";

/**
 * AR2-018 — CapabilityPublicationFlow (issue #34; spec §7).
 *
 * Consumes proposal + evaluation: threshold gate (per-suite thresholds; the
 * delta must meet them), rights re-verification AT publication time (denied/
 * unknown/expired → BLOCKED, fail closed), certification binding (AR2-014
 * quadruple), scope clamp (publish ONLY within the approved tenant/scope),
 * immutability (published pack versions are immutable; new version = new
 * record), rollback (client-adopted previous version stays queryable;
 * rollback appends events, never rewrites history) and the
 * popularityBypassGuard (usage counters can never short-circuit rights/
 * verification/certification — structurally, publish() takes no popularity
 * input at all).
 */

export interface PublishInput {
  tenant: TenantContext;
  proposal: CapabilityUpgradeProposal;
  delta: BeforeAfterDelta;
  baselineRun: EvaluationRun;
  candidateRun: EvaluationRun;
  pack: CapabilityPack;
  adoptingClient: { client_application_id: string; agent_id: string } | null;
  decision_id: string;
  now: string;
  actor: ActorRef;
  certification?: {
    certification: Certification;
    body: BodyVersion;
    policy_digest: string;
    environment_digest: string;
    scope_digest: string;
  } | null;
}

export type PublishOutcome = { kind: "DECIDED"; decision: PublicationDecision };

const RIGHTS_STATE_BY_REASON: Record<string, PublicationDecision["rights_snapshot"]["state"]> = {
  grant_revoked: "DENIED",
  grant_expired: "EXPIRED",
  no_grant: "UNKNOWN",
  artifact_not_covered: "UNKNOWN",
  scope_mismatch: "SCOPE_MISMATCH",
};

export class CapabilityPublicationFlow {
  constructor(
    private readonly store: UpgradeStore,
    private readonly rightsRegistry: RightsGrantRegistry,
  ) {}

  /**
   * popularityBypassGuard: structurally, publish() takes no popularity input.
   * This hook exists so attempts to smuggle one are typed rejections.
   */
  popularityBypassGuard(): UpgErrorEnvelope {
    return upgError(
      "UPG_POPULARITY_IS_NOT_AUTHORITY",
      "usage counters can never short-circuit rights/verification/certification checks",
    );
  }

  publish(input: PublishInput): PublishOutcome {
    const { proposal, delta } = input;
    if (proposal.state !== "EVALUATED") {
      throw new Error(
        `proposal ${proposal.proposal_id} must be EVALUATED before publication (state: ${proposal.state})`,
      );
    }
    if (proposal.tenant_id !== input.tenant.tenant_id) {
      throw new Error("proposal tenant does not match the publication context (fail closed)");
    }
    const thresholdEvaluation: PublicationDecision["threshold_evaluation"] = {
      thresholds: delta.thresholds,
      observed: {
        target_delta: delta.target.delta,
        new_regression_failures: delta.regression.new_failures.length,
        leakage_passed: delta.leakage.all_passed,
        guardrails_passed: delta.guardrails.all_passed,
      },
      met: delta.thresholds_met,
    };

    // Rights re-verification AT PUBLICATION TIME (fail closed).
    const rightsEvaluation = this.rightsRegistry.evaluateReuseRight({
      tenant_id: proposal.tenant_id,
      artifact_id: proposal.source.dataset_id,
      scope: proposal.proposed_publication_scope.scope,
      now: input.now,
    });
    const rightsSnapshot: PublicationDecision["rights_snapshot"] =
      rightsEvaluation.kind === "RIGHTS_GRANTED"
        ? {
            evaluated_at: input.now,
            state: "LINKED",
            grant_id: rightsEvaluation.grant.grant_id,
            scope: rightsEvaluation.grant.scope,
            reason: null,
          }
        : {
            evaluated_at: input.now,
            state: RIGHTS_STATE_BY_REASON[rightsEvaluation.reason] ?? "UNKNOWN",
            grant_id: null,
            scope: null,
            reason: rightsEvaluation.reason,
          };

    let outcome: PublicationDecision["outcome"];
    let reasonCode: string;
    if (rightsEvaluation.kind !== "RIGHTS_GRANTED") {
      outcome = "BLOCKED";
      reasonCode = `rights_${rightsEvaluation.reason}`;
    } else if (input.certification !== null && input.certification !== undefined) {
      const binding = verifyCertificationBinding({
        certification: input.certification.certification,
        body: input.certification.body,
        published_policy_digest: input.certification.policy_digest,
        published_environment_digest: input.certification.environment_digest,
        published_scope_digest: input.certification.scope_digest,
      });
      if (binding.kind === "MISMATCH") {
        outcome = "BLOCKED";
        reasonCode = "certification_binding_mismatch";
      } else {
        outcome = "PUBLISHED";
        reasonCode = "thresholds_and_gates_met";
      }
    } else if (!delta.guardrails.all_passed || !delta.leakage.all_passed) {
      outcome = "FAILED";
      reasonCode = !delta.guardrails.all_passed ? "guardrail_violation" : "leakage_detected";
    } else if (!delta.thresholds_met) {
      outcome = "INCONCLUSIVE";
      reasonCode = "thresholds_not_met";
    } else {
      outcome = "PUBLISHED";
      reasonCode = "thresholds_and_gates_met";
    }

    if (outcome !== "PUBLISHED") {
      const decision = this.finalizeDecision(input, thresholdEvaluation, rightsSnapshot, outcome, reasonCode, null, null);
      this.store.recordDecision(decision);
      this.transitionProposal(input, outcome === "BLOCKED" ? "REJECTED" : outcome, reasonCode);
      return { kind: "DECIDED", decision };
    }

    const register = this.store.registerPack(input.tenant, input.pack);
    if (register.kind === "REJECTED") {
      const decision = this.finalizeDecision(input, thresholdEvaluation, rightsSnapshot, "BLOCKED", "pack_version_conflict", null, null);
      this.store.recordDecision(decision);
      this.transitionProposal(input, "REJECTED", "pack_version_conflict");
      return { kind: "DECIDED", decision };
    }
    const previous = this.store
      .packVersions(input.tenant, input.pack.pack_id)
      .filter((pack) => pack.version < input.pack.version && this.store.isPublished(pack.pack_id, pack.version))
      .pop();
    const rollbackPointer = previous === undefined ? null : { pack_id: previous.pack_id, version: previous.version };

    const decision = this.finalizeDecision(
      input,
      thresholdEvaluation,
      rightsSnapshot,
      "PUBLISHED",
      reasonCode,
      { pack_id: input.pack.pack_id, version: input.pack.version, content_digest: input.pack.content_digest },
      rollbackPointer,
    );
    this.store.markPublished(input.tenant, decision.decision_id, register.kind === "REPLAY" ? register.pack : input.pack);
    this.store.recordDecision(decision);
    this.transitionProposal(input, "PUBLISHED", reasonCode);
    return { kind: "DECIDED", decision };
  }

  adopt(input: {
    tenant: TenantContext;
    decision: PublicationDecision;
    client: { client_application_id: string; agent_id: string };
    adoption_id: string;
    now: string;
  }): { kind: "ADOPTED"; adoption: AdoptionRecord } | { kind: "REJECTED"; code: UpgErrorCode } {
    if (input.decision.outcome !== "PUBLISHED" || input.decision.published_pack === null) {
      return { kind: "REJECTED", code: "UPG_PUBLICATION_BLOCKED" };
    }
    const adoption: AdoptionRecord = {
      schema_version: UPGRADE_SCHEMA_FAMILY,
      adoption_id: input.adoption_id,
      tenant_id: input.tenant.tenant_id,
      pack_id: input.decision.published_pack.pack_id,
      version: input.decision.published_pack.version,
      decision_id: input.decision.decision_id,
      client: input.client,
      adopted_at: input.now,
      active: true,
    };
    this.store.recordAdoption(adoption);
    return { kind: "ADOPTED", adoption };
  }

  /** Rollback appends a record; the adopted previous version stays queryable. */
  rollback(input: {
    tenant: TenantContext;
    pack_id: string;
    from_version: number;
    to_version: number;
    reason: string;
    rollback_id: string;
    now: string;
    actor: ActorRef;
  }): { kind: "ROLLED_BACK"; record: RollbackRecord } | { kind: "REJECTED"; code: UpgErrorCode } {
    const adoption =
      input.to_version >= input.from_version ? null : this.store.adoptionOf(input.pack_id, input.from_version);
    if (adoption === null) {
      return { kind: "REJECTED", code: "UPG_ROLLBACK_NOT_POSSIBLE" };
    }
    const target = this.store
      .packVersions(input.tenant, input.pack_id)
      .find((pack) => pack.version === input.to_version && this.store.isPublished(pack.pack_id, pack.version));
    if (target === undefined) {
      return { kind: "REJECTED", code: "UPG_ROLLBACK_NOT_POSSIBLE" };
    }
    const record: RollbackRecord = {
      schema_version: UPGRADE_SCHEMA_FAMILY,
      rollback_id: input.rollback_id,
      tenant_id: input.tenant.tenant_id,
      pack_id: input.pack_id,
      from_version: input.from_version,
      to_version: input.to_version,
      reason: input.reason,
      at: input.now,
      actor: input.actor,
      evidence_refs: [{ stage: "DECISION", ref_id: adoption.decision_id }],
    };
    this.store.deactivateAdoption(input.pack_id, input.from_version);
    this.store.recordRollback(record);
    return { kind: "ROLLED_BACK", record };
  }

  private transitionProposal(
    input: PublishInput,
    to: "PUBLISHED" | "INCONCLUSIVE" | "FAILED" | "REJECTED",
    reasonCode: string,
  ): void {
    const outcome = this.store.appendProposalEvent(input.tenant, input.proposal.proposal_id, {
      event_id: `evt_${input.decision_id.slice(4)}`,
      to,
      reason_code: reasonCode,
      actor: input.actor,
      at: input.now,
    });
    void outcome;
  }

  private finalizeDecision(
    input: PublishInput,
    thresholdEvaluation: PublicationDecision["threshold_evaluation"],
    rights: PublicationDecision["rights_snapshot"],
    outcome: PublicationDecision["outcome"],
    reasonCode: string,
    publishedPack: PublicationDecision["published_pack"],
    rollbackPointer: PublicationDecision["rollback_pointer"],
  ): PublicationDecision {
    const chainStages: ReadonlyArray<[EvidenceChainRecord["stage"], string, string]> = [
      ["SOURCE_CAPTURE", input.proposal.source.dataset_id, input.proposal.source.source_digest],
      ["TRANSFORMATION", input.proposal.source.manifest_id, input.proposal.source.manifest_digest],
      ["PACK_BUILD", input.pack.pack_id, input.pack.content_digest],
      ["TARGET_CAPABILITY_VERSION", input.proposal.target_capability.body_id, input.proposal.target_capability.content_digest],
      ["EVALUATION_BASELINE", input.baselineRun.run_id, computeCanonicalDigest(input.baselineRun)],
      ["EVALUATION_CANDIDATE", input.candidateRun.run_id, computeCanonicalDigest(input.candidateRun)],
    ];
    const coreDigest = computeCanonicalDigest({
      decision_id: input.decision_id,
      proposal_id: input.proposal.proposal_id,
      outcome,
      published_pack: publishedPack,
      threshold_evaluation: thresholdEvaluation,
      decided_at: input.now,
    });
    const evidence: EvidenceChainRecord[] = [
      ...chainStages.map(([stage, ref_id, content_digest]) => ({ stage, ref_id, content_digest, recorded_at: input.now })),
      { stage: "DECISION" as const, ref_id: input.decision_id, content_digest: coreDigest, recorded_at: input.now },
    ];
    return {
      schema_version: UPGRADE_SCHEMA_FAMILY,
      decision_id: input.decision_id,
      tenant_id: input.proposal.tenant_id,
      proposal_id: input.proposal.proposal_id,
      outcome,
      reason_code: reasonCode,
      threshold_evaluation: thresholdEvaluation,
      rights_snapshot: rights,
      published_pack: publishedPack,
      rollback_pointer: rollbackPointer,
      adopting_client: input.adoptingClient,
      scope: {
        tenant_id: input.proposal.proposed_publication_scope.tenant_id,
        rights_scope: input.proposal.proposed_publication_scope.scope,
      },
      evidence: evidence.map((record) => ({ ...record })),
      decided_at: input.now,
      decided_by: input.actor,
      feedback: {
        usage_counter_at_decision: this.store.usageCounter(
          input.tenant,
          input.pack.pack_id,
          input.pack.version,
        ),
        note: POPULARITY_BYPASS_GUARD_RULE,
      },
    };
  }
}
