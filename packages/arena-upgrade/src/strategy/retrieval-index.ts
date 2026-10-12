import { contentHashOf } from "@arena/scraper";
import { computePackContentDigest, type CapabilityPack } from "../pack.js";
import type { CapabilityUpgradeProposal } from "../proposal.js";
import {
  baselinePackRecordFields,
  mostRestrictiveClass,
  scopeEntries,
  tokenize,
  type CapabilityStrategy,
  type StrategyApplicabilityInput,
  type StrategyBuildInput,
  type StrategyBuildOutcome,
} from "./port.js";

/**
 * AR2-018 — ScopedRetrievalIndexStrategy (issue #34; spec §7 strategy 1).
 *
 * Builds a deterministic, tenant/rights-scoped retrieval index over the
 * transformed dataset: a term/keyword index with content-addressed entries,
 * pure TypeScript, no external vector DB. Entries outside the licensed
 * redaction-class scope never enter the index (recorded as exclusions).
 */

export class ScopedRetrievalIndexStrategy implements CapabilityStrategy {
  readonly strategy = "SCOPED_RETRIEVAL_INDEX" as const;

  applicable(input: StrategyApplicabilityInput): { applicable: boolean; reason_code: string } {
    const usable = input.entries.filter((entry) => entry.content.trim().length > 0).length;
    const permitted =
      input.policy.permitted_use_kinds.includes("INDEX") ||
      input.policy.permitted_use_kinds.includes("RETRIEVAL");
    if (!permitted) return { applicable: false, reason_code: "retrieval_use_not_permitted" };
    if (usable < 1) return { applicable: false, reason_code: "no_textual_entries" };
    return { applicable: true, reason_code: "textual_entries_available" };
  }

  build(input: StrategyBuildInput): StrategyBuildOutcome {
    const scoped = scopeEntries(input.entries, input.policy);
    if (scoped.included.length === 0) {
      return {
        kind: "BLOCKED",
        code: "UPG_STRATEGY_NOT_APPLICABLE",
        issues: [{ field: "entries", rule: "no entries survive the policy redaction-class scope" }],
      };
    }
    const proposal: CapabilityUpgradeProposal = input.proposal;
    const entries = scoped.included.map(({ entry, content }) => ({
      entry_id: entry.entry_id,
      content_digest: contentHashOf(content),
      terms: [...new Set(tokenize(content))].slice(0, 256),
      content,
      source_url: entry.source_url,
      license_assessment: entry.license_assessment,
      redaction_class: entry.redaction_class,
    }));
    const draft: CapabilityPack = {
      ...baselinePackRecordFields(input),
      strategy: this.strategy,
      payload: {
        kind: "SCOPED_RETRIEVAL_INDEX",
        scope: { tenant_id: proposal.tenant_id, rights_scope: proposal.proposed_publication_scope.scope },
        entries,
      },
      retention_expiry: {
        ...baselinePackRecordFields(input).retention_expiry,
        redaction_class: mostRestrictiveClass(scoped.included.map(({ entry }) => entry.redaction_class)),
        excluded_entry_count: scoped.excluded.length,
      },
      content_digest: "0".repeat(64),
    };
    const pack: CapabilityPack = { ...draft, content_digest: computePackContentDigest(draft) };
    return {
      kind: "BUILT",
      pack,
      log: {
        strategy: this.strategy,
        included: entries.length,
        excluded: scoped.excluded,
        notes: ["tenant/rights-scoped term index; content-addressed entries"],
      },
    };
  }
}
