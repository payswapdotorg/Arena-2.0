import { computePackContentDigest, type CapabilityPack } from "../pack.js";
import {
  baselinePackRecordFields,
  mostRestrictiveClass,
  scopeEntries,
  type CapabilityStrategy,
  type StrategyApplicabilityInput,
  type StrategyBuildInput,
  type StrategyBuildOutcome,
} from "./port.js";

/**
 * AR2-018 — ToolAdapterStrategy (issue #34; spec §7 strategy 3).
 *
 * Wraps a validated, permission-limited query interface over the dataset as
 * an explicit typed tool descriptor: interface (query action + parameters),
 * permissions (read_tenant_scoped only) and rate limits. The adapter is a
 * descriptor + guarded runtime; it never exposes bulk export.
 */

export class ToolAdapterStrategy implements CapabilityStrategy {
  readonly strategy = "TOOL_ADAPTER" as const;

  applicable(input: StrategyApplicabilityInput): { applicable: boolean; reason_code: string } {
    if (!input.policy.permitted_use_kinds.includes("TOOL_ADAPTER")) {
      return { applicable: false, reason_code: "tool_adapter_use_not_permitted" };
    }
    if (input.entries.length < 1) return { applicable: false, reason_code: "no_entries_to_serve" };
    return { applicable: true, reason_code: "query_interface_permitted" };
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
    const base = baselinePackRecordFields(input);
    const entries = scoped.included.map(({ entry, content }) => ({
      entry_id: entry.entry_id,
      content,
      source_url: entry.source_url,
      license_assessment: entry.license_assessment,
      redaction_class: entry.redaction_class,
    }));
    const draft: CapabilityPack = {
      ...base,
      strategy: this.strategy,
      payload: {
        kind: "TOOL_ADAPTER",
        scope: { tenant_id: input.proposal.tenant_id, rights_scope: input.proposal.proposed_publication_scope.scope },
        tool: {
          tool_id: input.pack_id,
          interface: {
            actions: [{ name: "query", parameters: ["terms"] }],
          },
          permissions: ["read_tenant_scoped"],
          rate_limits: { max_calls_per_minute: 60 },
          dataset_digest: base.source_dataset_digest,
        },
        entries,
      },
      retention_expiry: {
        ...base.retention_expiry,
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
        included: scoped.included.length,
        excluded: scoped.excluded,
        notes: ["typed tool descriptor: query-only interface, read_tenant_scoped permission, 60 calls/minute"],
      },
    };
  }
}
