import type { CapabilityPack } from "./pack.js";
import { tokenize } from "./strategy/port.js";

/**
 * AR2-018 — pack runtime (issue #34).
 *
 * The strategy-facing consultation surface a target agent uses to consult an
 * attached CapabilityPack. Cross-tenant attachment fails closed (null —
 * indistinguishable from "no pack"): a pack built for tenant A can never be
 * consulted under tenant B's identity. All runtimes are deterministic and
 * pure; prompt-injection text inside pack content stays DATA (it is only ever
 * matched, scored and quoted as inert reference material).
 */

export interface ConsultationHint {
  /** Candidate reference content (inert data, never instructions). */
  hint: string;
  citation: string;
}

export interface PackConsultation {
  readonly kind: CapabilityPack["payload"]["kind"];
  /** Best-effort deterministic lookup for a natural-language question. */
  consult(question: string): ConsultationHint | null;
}

export interface ToolRuntimeOptions {
  /** Injected clock (ms) for rate-limit accounting; default: fixed zero epoch. */
  nowMs?: () => number;
}

export interface ToolQueryOutcome {
  kind: "RESULT" | "REFUSED";
  rows?: ReadonlyArray<{ content: string; source_url: string }>;
  reason?: string;
}

/**
 * Attach a pack for a requesting tenant. Wrong tenant → null (fail closed,
 * no existence oracle). The tool-adapter runtime additionally enforces its
 * permission and rate-limit surface.
 */
export function createPackConsultation(
  pack: CapabilityPack,
  requestingTenantId: string,
  options: ToolRuntimeOptions = {},
): PackConsultation | null {
  if (pack.tenant_id !== requestingTenantId) return null;
  const payload = pack.payload;
  switch (payload.kind) {
    case "SCOPED_RETRIEVAL_INDEX": {
      return {
        kind: "SCOPED_RETRIEVAL_INDEX",
        consult(question: string): ConsultationHint | null {
          const terms = new Set(tokenize(question));
          let best: { score: number; hint: string; citation: string } | null = null;
          for (const entry of payload.entries) {
            let score = 0;
            for (const term of entry.terms) {
              if (terms.has(term)) score += 1;
            }
            if (score >= 2 && (best === null || score > best.score)) {
              best = {
                score,
                hint: entry.content,
                citation: entry.source_url,
              };
            }
          }
          return best === null ? null : { hint: best.hint, citation: best.citation };
        },
      };
    }
    case "STRUCTURED_KNOWLEDGE_PACK": {
      return {
        kind: "STRUCTURED_KNOWLEDGE_PACK",
        consult(question: string): ConsultationHint | null {
          const terms = tokenize(question);
          for (const row of payload.table) {
            if (terms.includes(row.key.toLowerCase())) {
              const lines = Object.entries(row.fields)
                .map(([name, value]) => `${name}: ${value}`)
                .join("\n");
              return { hint: `material: ${row.key}\n${lines}`, citation: row.citation.source_url };
            }
          }
          return null;
        },
      };
    }
    case "TOOL_ADAPTER": {
      const window = new Map<string, number>();
      return {
        kind: "TOOL_ADAPTER",
        consult(question: string): ConsultationHint | null {
          const call = toolQuery(pack, requestingTenantId, question, { ...options, windowRef: window });
          if (call.kind !== "RESULT" || call.rows === undefined || call.rows.length === 0) return null;
          return { hint: call.rows[0]!.content, citation: call.rows[0]!.source_url };
        },
      };
    }
    case "RULES_EXAMPLES": {
      return {
        kind: "RULES_EXAMPLES",
        consult(question: string): ConsultationHint | null {
          const terms = tokenize(question);
          for (const artifact of payload.artifacts) {
            if (tokenize(artifact.rule_text).some((term) => terms.includes(term))) {
              return { hint: `rule: ${artifact.rule_text}`, citation: artifact.citation.source_url };
            }
          }
          return null;
        },
      };
    }
  }
}

export interface ToolQueryOptions extends ToolRuntimeOptions {
  /** Shared per-window call counter (owned by the runtime closure). */
  windowRef?: Map<string, number>;
}

/**
 * Guarded tool invocation over the dataset: query-only interface,
 * read_tenant_scoped permission, per-minute rate limit. Any attempt to
 * invoke an action outside the descriptor (e.g. bulk export) is refused.
 */
export function toolQuery(
  pack: CapabilityPack,
  requestingTenantId: string,
  terms: string,
  options: ToolQueryOptions = {},
): ToolQueryOutcome {
  if (pack.tenant_id !== requestingTenantId) {
    return { kind: "REFUSED", reason: "pack not visible in tenant scope" };
  }
  if (pack.payload.kind !== "TOOL_ADAPTER") {
    return { kind: "REFUSED", reason: "pack does not expose a tool interface" };
  }
  const tool = pack.payload.tool;
  const scopedEntries = pack.payload.entries;
  const allowedActions = new Set(tool.interface.actions.map((action) => action.name));
  if (!allowedActions.has("query")) {
    return { kind: "REFUSED", reason: "action not in the declared tool interface" };
  }
  if (!tool.permissions.includes("read_tenant_scoped")) {
    return { kind: "REFUSED", reason: "tool does not carry the read_tenant_scoped permission" };
  }
  const window = options.windowRef ?? new Map<string, number>();
  const nowMs = options.nowMs?.() ?? 0;
  const minuteKey = `${nowMs - (nowMs % 60_000)}`;
  const count = window.get(minuteKey) ?? 0;
  if (count >= tool.rate_limits.max_calls_per_minute) {
    return { kind: "REFUSED", reason: "rate_limit" };
  }
  window.set(minuteKey, count + 1);
  // Deterministic dataset-backed query over the tool's scoped entries.
  const requested = new Set(tokenize(terms));
  const rows: Array<{ content: string; source_url: string }> = [];
  for (const entry of scopedEntries) {
    if (rows.length >= 5) break;
    const entryTerms = new Set(tokenize(entry.content));
    let score = 0;
    for (const term of requested) {
      if (entryTerms.has(term)) score += 1;
    }
    if (score >= 2) rows.push({ content: entry.content, source_url: entry.source_url });
  }
  return { kind: "RESULT", rows };
}

