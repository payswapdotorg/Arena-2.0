import { computeCanonicalDigest } from "@arena/acquisition";
import { computePackContentDigest, type CapabilityPack } from "../pack.js";
import type { TransformedEntry } from "../manifest.js";
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
 * AR2-018 — StructuredKnowledgePackStrategy (issue #34; spec §7 strategy 2).
 *
 * Normalizes the dataset into a typed reference table / knowledge pack with
 * per-entry provenance and citation: each entry's "key: value" lines become a
 * typed row keyed by its `material`-style primary key, carrying the source
 * citation (URL, retrieval time, license assessment).
 */

const KEY_VALUE_LINE = /^([\w][\w ]{0,63}):[ \t](.+)$/;

export function parseKeyedFields(content: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of content.split("\n")) {
    const match = KEY_VALUE_LINE.exec(line.trim());
    if (match !== null) fields.set(match[1]!.toLowerCase(), match[2]!.trim());
  }
  return fields;
}

export class StructuredKnowledgePackStrategy implements CapabilityStrategy {
  readonly strategy = "STRUCTURED_KNOWLEDGE_PACK" as const;

  applicable(input: StrategyApplicabilityInput): { applicable: boolean; reason_code: string } {
    if (!input.policy.permitted_use_kinds.includes("KNOWLEDGE_PACK")) {
      return { applicable: false, reason_code: "knowledge_pack_use_not_permitted" };
    }
    const structured = input.entries.filter((entry) => parseKeyedFields(entry.content).size >= 2).length;
    if (structured < 1) return { applicable: false, reason_code: "no_structured_records" };
    return { applicable: true, reason_code: "structured_records_available" };
  }

  build(input: StrategyBuildInput): StrategyBuildOutcome {
    const scoped = scopeEntries(input.entries, input.policy);
    const usable = scoped.included.filter(({ entry }) => parseKeyedFields(entry.content).size >= 2);
    if (usable.length === 0) {
      return {
        kind: "BLOCKED",
        code: "UPG_STRATEGY_NOT_APPLICABLE",
        issues: [{ field: "entries", rule: "no entries parse as structured key-value records" }],
      };
    }
    const table = usable.map(({ entry, content }) => {
      const fields = parseKeyedFields(content);
      const key = fields.get("material") ?? fields.keys().next().value ?? entry.entry_id;
      const fieldsRecord: Record<string, string> = {};
      for (const [name, value] of fields) {
        if (name !== "material") fieldsRecord[name] = value;
      }
      return {
        key,
        fields: fieldsRecord,
        citation: {
          source_url: entry.source_url,
          retrieved_at: entry.retrieved_at,
          license_assessment: entry.license_assessment,
        },
        redaction_class: entry.redaction_class,
      };
    });
    const base = baselinePackRecordFields(input);
    const draft: CapabilityPack = {
      ...base,
      strategy: this.strategy,
      payload: {
        kind: "STRUCTURED_KNOWLEDGE_PACK",
        scope: { tenant_id: input.proposal.tenant_id, rights_scope: input.proposal.proposed_publication_scope.scope },
        table,
      },
      retention_expiry: {
        ...base.retention_expiry,
        redaction_class: mostRestrictiveClass(usable.map(({ entry }: { entry: TransformedEntry }) => entry.redaction_class)),
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
        included: table.length,
        excluded: scoped.excluded,
        notes: [`table normalization digest anchor ${computeCanonicalDigest(table).slice(0, 16)}`],
      },
    };
  }
}
