import {
  tenantContextSchema,
  type TenantContext,
} from "@arena/contracts";
import { computeCanonicalDigest } from "@arena/acquisition";
import {
  capabilityUpgradeProposalSchema,
  computeProposalDigest,
  evaluateProposalTransition,
  proposalStateSchema,
  validateProposalSemantics,
  type CapabilityUpgradeProposal,
} from "./proposal.js";
import { capabilityPackSchema, computePackContentDigest, type CapabilityPack } from "./pack.js";
import type { EvaluationRun, BeforeAfterDelta } from "./eval/run.js";
import type { UpgErrorCode } from "./errors.js";
import type { PublicationDecision, RollbackRecord, AdoptionRecord } from "./publish/publication.js";

/**
 * AR2-018 — UpgradeStore (issue #34).
 *
 * In-memory tenant-scoped reference store (durable wiring is the TL's
 * integration station, mirroring how arena-scraper staged RunStore).
 * Cross-tenant reads fail closed and are INDISTINGUABLE from missing
 * (404-style, no existence oracle). Idempotency mirrors ACQ1.0: same key +
 * same digest → replay; different digest → typed conflict. Proposal events
 * and decision/rollback ledgers are append-only; nothing rewrites history.
 */

type SubmitOutcome =
  | { kind: "RECORDED"; proposal: CapabilityUpgradeProposal }
  | { kind: "REPLAY"; proposal: CapabilityUpgradeProposal }
  | { kind: "REJECTED"; code: UpgErrorCode; issues: Array<{ field: string; rule: string }> };

type EventOutcome =
  | { kind: "APPENDED"; from: string; to: string }
  | { kind: "BLOCKED"; code: UpgErrorCode; issues: Array<{ field: string; rule: string }> };

type PackOutcome =
  | { kind: "RECORDED"; pack: CapabilityPack }
  | { kind: "REPLAY"; pack: CapabilityPack }
  | { kind: "REJECTED"; code: UpgErrorCode; issues: Array<{ field: string; rule: string }> };

export class UpgradeStore {
  private readonly proposals = new Map<string, CapabilityUpgradeProposal>();
  private readonly idempotency = new Map<string, { digest: string; proposal_id: string }>();
  private readonly packs = new Map<string, CapabilityPack>();
  private readonly published = new Map<string, { decision_id: string; pack: CapabilityPack }>();
  private readonly decisions: PublicationDecision[] = [];
  private readonly rollbacks: RollbackRecord[] = [];
  private readonly adoptions: AdoptionRecord[] = [];
  private readonly evaluations: EvaluationRun[] = [];
  private readonly deltas: BeforeAfterDelta[] = [];
  private readonly usage = new Map<string, number>();

  submitProposal(tenant: TenantContext, proposal: unknown): SubmitOutcome {
    if (tenantContextSchema.safeParse(tenant).success === false) {
      return { kind: "REJECTED", code: "UPG_TENANT_CONTEXT_INVALID", issues: [] };
    }
    const parsed = capabilityUpgradeProposalSchema.safeParse(proposal);
    if (!parsed.success) {
      return {
        kind: "REJECTED",
        code: "UPG_VALIDATION_FAILED",
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
          rule: `${issue.code}${issue.message ? ` — ${issue.message}` : ""}`,
        })),
      };
    }
    const candidate = parsed.data;
    if (candidate.tenant_id !== tenant.tenant_id) {
      return {
        kind: "REJECTED",
        code: "UPG_TENANT_MISMATCH",
        issues: [{ field: "tenant_id", rule: "proposal tenant does not match the authenticated tenant" }],
      };
    }
    const semantic = validateProposalSemantics(candidate);
    if (semantic.length > 0) {
      return { kind: "REJECTED", code: "UPG_VALIDATION_FAILED", issues: semantic };
    }
    if (candidate.state !== "SUBMITTED" || candidate.events.length > 0) {
      return {
        kind: "REJECTED",
        code: "UPG_PROPOSAL_IMMUTABLE",
        issues: [{ field: "state", rule: "new proposals are submitted in the SUBMITTED state with no events" }],
      };
    }
    const key = `${tenant.tenant_id}|${candidate.idempotency_key}`;
    const digest = computeProposalDigest(candidate);
    const existing = this.idempotency.get(key);
    if (existing !== undefined) {
      const stored = this.proposals.get(existing.proposal_id);
      if (stored !== undefined && computeProposalDigest(stored) === digest) {
        return { kind: "REPLAY", proposal: stored };
      }
      return {
        kind: "REJECTED",
        code: "UPG_IDEMPOTENCY_DIGEST_MISMATCH",
        issues: [{ field: "idempotency_key", rule: "same key with a different proposal digest" }],
      };
    }
    this.proposals.set(candidate.proposal_id, candidate);
    this.idempotency.set(key, { digest, proposal_id: candidate.proposal_id });
    return { kind: "RECORDED", proposal: candidate };
  }

  getProposal(tenant: TenantContext, proposalId: string): CapabilityUpgradeProposal | null {
    const proposal = this.proposals.get(proposalId);
    if (proposal === undefined || proposal.tenant_id !== tenant.tenant_id) return null;
    return proposal;
  }

  appendProposalEvent(
    tenant: TenantContext,
    proposalId: string,
    event: { event_id: string; to: string; reason_code: string; actor: { actor_id: string; role: string }; at: string; evidence?: Array<{ ref_kind: string; ref_id: string; digest: string }> },
  ): EventOutcome {
    const proposal = this.getProposal(tenant, proposalId);
    if (proposal === null) {
      return { kind: "BLOCKED", code: "UPG_NOT_FOUND", issues: [] };
    }
    const to = proposalStateSchema.safeParse(event.to);
    if (!to.success) {
      return { kind: "BLOCKED", code: "UPG_VALIDATION_FAILED", issues: [{ field: "to", rule: "unknown target state" }] };
    }
    const transition = evaluateProposalTransition(proposal.state, to.data);
    if (!transition.ok) {
      return {
        kind: "BLOCKED",
        code: transition.code,
        issues: [
          {
            field: "state",
            rule: `illegal transition ${proposal.state} -> ${to.data}; allowed: ${transition.allowed.join(", ") || "(terminal)"}`,
          },
        ],
      };
    }
    const from = proposal.state;
    proposal.events.push({
      event_id: event.event_id,
      at: event.at,
      from,
      to: to.data,
      reason_code: event.reason_code,
      actor: event.actor as CapabilityUpgradeProposal["events"][number]["actor"],
      evidence: (event.evidence ?? []).slice(0, 16),
    });
    proposal.state = to.data;
    return { kind: "APPENDED", from, to: to.data };
  }

  registerPack(tenant: TenantContext, pack: unknown): PackOutcome {
    const parsed = capabilityPackSchema.safeParse(pack);
    if (!parsed.success) {
      return {
        kind: "REJECTED",
        code: "UPG_VALIDATION_FAILED",
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
          rule: `${issue.code}${issue.message ? ` — ${issue.message}` : ""}`,
        })),
      };
    }
    const candidate = parsed.data;
    if (candidate.tenant_id !== tenant.tenant_id) {
      return {
        kind: "REJECTED",
        code: "UPG_TENANT_MISMATCH",
        issues: [{ field: "tenant_id", rule: "pack tenant does not match the authenticated tenant" }],
      };
    }
    const key = `${candidate.pack_id}|${candidate.version}`;
    const existing = this.packs.get(key);
    if (existing !== undefined) {
      return computePackContentDigest(existing) === candidate.content_digest
        ? { kind: "REPLAY", pack: existing }
        : {
            kind: "REJECTED",
            code: "UPG_PUBLISHED_VERSION_IMMUTABLE",
            issues: [{ field: "version", rule: "published pack versions are immutable; a change is a new version" }],
          };
    }
    const sameLineage = [...this.packs.values()].filter((other) => other.pack_id === candidate.pack_id);
    if (sameLineage.some((other) => other.version >= candidate.version)) {
      return {
        kind: "REJECTED",
        code: "UPG_PUBLISHED_VERSION_IMMUTABLE",
        issues: [{ field: "version", rule: "pack versions are immutable and monotonically increasing" }],
      };
    }
    if (candidate.content_digest !== computePackContentDigest(candidate)) {
      return {
        kind: "REJECTED",
        code: "UPG_INTEGRITY_MISMATCH",
        issues: [{ field: "content_digest", rule: "pack digest does not match its deterministic recomputation" }],
      };
    }
    this.packs.set(key, candidate);
    return { kind: "RECORDED", pack: candidate };
  }

  getPack(tenant: TenantContext, packId: string, version: number): CapabilityPack | null {
    const pack = this.packs.get(`${packId}|${version}`);
    if (pack === undefined || pack.tenant_id !== tenant.tenant_id) return null;
    return pack;
  }

  packVersions(tenant: TenantContext, packId: string): CapabilityPack[] {
    return [...this.packs.values()]
      .filter((pack) => pack.pack_id === packId && pack.tenant_id === tenant.tenant_id)
      .sort((a, b) => a.version - b.version);
  }

  markPublished(tenant: TenantContext, decisionId: string, pack: CapabilityPack): void {
    if (pack.tenant_id !== tenant.tenant_id) return;
    this.published.set(`${pack.pack_id}|${pack.version}`, { decision_id: decisionId, pack });
  }

  isPublished(packId: string, version: number): boolean {
    return this.published.has(`${packId}|${version}`);
  }

  recordDecision(decision: PublicationDecision): void {
    this.decisions.push(decision);
  }

  listDecisions(tenant: TenantContext): readonly PublicationDecision[] {
    return this.decisions.filter((decision) => decision.tenant_id === tenant.tenant_id).map((decision) => structuredClone(decision));
  }

  recordRollback(rollback: RollbackRecord): void {
    this.rollbacks.push(rollback);
  }

  listRollbacks(tenant: TenantContext): readonly RollbackRecord[] {
    return this.rollbacks.filter((record) => record.tenant_id === tenant.tenant_id).map((record) => structuredClone(record));
  }

  recordAdoption(adoption: AdoptionRecord): void {
    this.adoptions.push(adoption);
  }

  adoptionOf(packId: string, version: number): AdoptionRecord | null {
    return (
      this.adoptions.find((adoption) => adoption.pack_id === packId && adoption.version === version && adoption.active) ?? null
    );
  }

  deactivateAdoption(packId: string, version: number): void {
    const adoption = this.adoptions.find(
      (candidate) => candidate.pack_id === packId && candidate.version === version && candidate.active,
    );
    if (adoption !== undefined) adoption.active = false;
  }

  recordEvaluation(run: EvaluationRun): void {
    this.evaluations.push(run);
  }

  recordDelta(delta: BeforeAfterDelta): void {
    this.deltas.push(delta);
  }

  /** Deep-copied snapshots: callers can never mutate historic evidence. */
  evaluationRecords(tenant: TenantContext): readonly EvaluationRun[] {
    return this.evaluations
      .filter((run) => run.tenant_id === tenant.tenant_id)
      .map((run) => structuredClone(run));
  }

  deltaRecords(tenant: TenantContext): readonly BeforeAfterDelta[] {
    return this.deltas
      .filter((delta) => delta.tenant_id === tenant.tenant_id)
      .map((delta) => structuredClone(delta));
  }

  /** Usage signals are recorded but NEVER consulted by publication decisions. */
  recordUsageSignal(tenant: TenantContext, packId: string, version: number): number {
    const key = `${tenant.tenant_id}|${packId}|${version}`;
    const next = (this.usage.get(key) ?? 0) + 1;
    this.usage.set(key, next);
    return next;
  }

  usageCounter(tenant: TenantContext, packId: string, version: number): number {
    return this.usage.get(`${tenant.tenant_id}|${packId}|${version}`) ?? 0;
  }
}

/** Canonical digest helper re-exported for store consumers. */
export { computeCanonicalDigest };
