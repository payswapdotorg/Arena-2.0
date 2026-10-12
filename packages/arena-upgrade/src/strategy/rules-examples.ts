import { computePackContentDigest, type CapabilityPack } from "../pack.js";
import { parseKeyedFields } from "./knowledge-pack.js";
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
 * AR2-018 — RulesExamplesStrategy (issue #34; spec §7 strategy 4).
 *
 * Extracts evaluated example/rules artifacts: entries carrying a `rule` line
 * (plus optional example_input/example_output lines) become rule artifacts
 * with full citation. Entries without rule-shaped content never enter the
 * artifact set.
 */

export class RulesExamplesStrategy implements CapabilityStrategy {
  readonly strategy = "RULES_EXAMPLES" as const;

  applicable(input: StrategyApplicabilityInput): { applicable: boolean; reason_code: string } {
    if (!input.policy.permitted_use_kinds.includes("EXAMPLES_RULES")) {
      return { applicable: false, reason_code: "examples_rules_use_not_permitted" };
    }
    const ruleShaped = input.entries.filter((entry) => parseKeyedFields(entry.content).has("rule")).length;
    if (ruleShaped < 1) return { applicable: false, reason_code: "no_rule_shaped_entries" };
    return { applicable: true, reason_code: "rule_shaped_entries_available" };
  }

  build(input: StrategyBuildInput): StrategyBuildOutcome {
    const scoped = scopeEntries(input.entries, input.policy);
    const usable = scoped.included.filter(({ content }) => parseKeyedFields(content).has("rule"));
    if (usable.length === 0) {
      return {
        kind: "BLOCKED",
        code: "UPG_STRATEGY_NOT_APPLICABLE",
        issues: [{ field: "entries", rule: "no entries carry a rule line after policy scoping" }],
      };
    }
    const artifacts = usable.map(({ entry, content }, index) => {
      const fields = parseKeyedFields(content);
      return {
        artifact_id: `rle_${input.pack_id.slice(4, 12)}${String(index + 1).padStart(4, "0")}`,
        rule_text: fields.get("rule") ?? entry.content.slice(0, 200),
        example_input: fields.get("example_input") ?? "(none)",
        example_output: fields.get("example_output") ?? "(none)",
        citation: {
          source_url: entry.source_url,
          retrieved_at: entry.retrieved_at,
          license_assessment: entry.license_assessment,
        },
      };
    });
    const base = baselinePackRecordFields(input);
    const draft: CapabilityPack = {
      ...base,
      strategy: this.strategy,
      payload: {
        kind: "RULES_EXAMPLES",
        scope: { tenant_id: input.proposal.tenant_id, rights_scope: input.proposal.proposed_publication_scope.scope },
        artifacts,
      },
      retention_expiry: {
        ...base.retention_expiry,
        redaction_class: mostRestrictiveClass(usable.map(({ entry }) => entry.redaction_class)),
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
        included: artifacts.length,
        excluded: scoped.excluded,
        notes: ["rule artifacts extracted from evaluated examples"],
      },
    };
  }
}
