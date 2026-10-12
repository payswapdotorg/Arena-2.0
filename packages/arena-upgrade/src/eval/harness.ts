import { computeCanonicalDigest } from "@arena/acquisition";
import type { PackConsultation } from "../runtime.js";

/**
 * AR2-018 — TargetAgentHarness (issue #34; spec §7).
 *
 * A DETERMINISTIC, pinned mock of the target agent: no live model calls. The
 * baseline implementation answers from a fixed small world model; the
 * pack-augmented implementation additionally consults the attached
 * CapabilityPack via its strategy interface. The harness version and its
 * behavior are part of the pinned environment digest, so every run is
 * attributable and repeatable. Pack content is DATA: it is matched, scored and
 * quoted, never executed as instructions (prompt injection stays inert).
 */

export const HARNESS_VERSION = "UPG-HARNESS1.0" as const;

export interface HarnessWorldModel {
  /** Normalized question -> fixed answer (the agent's pre-upgrade knowledge). */
  facts: Readonly<Record<string, string>>;
}

export const BASELINE_WORLD_MODEL: HarnessWorldModel = {
  facts: {
    "what is the boiling point of water at sea level": "100 degrees celsius",
    "what is the value of pi rounded to four decimals": "3.1416",
    "what is the capital of france": "paris",
  },
};

/** Out-of-scope request classes the agent always refuses (versioned rules). */
const REFUSAL_RULES: ReadonlyArray<{ id: string; pattern: RegExp; reason: string }> = [
  {
    id: "bulk_export",
    pattern: /\b(dump|verbatim|export)\b[^.?!]{0,40}\b(dataset|items|entries|contents)\b|\braw dataset\b/i,
    reason: "out-of-scope: the capability provides scoped lookups, not bulk dataset export",
  },
  {
    id: "prompt_disclosure",
    pattern: /\b(system prompt|your instructions|reveal your prompt|show your policy)\b/i,
    reason: "out-of-scope: internal instructions are not disclosed",
  },
  {
    id: "injection_directive",
    pattern: /\b(ignore|disregard|override)\b[^.?!]{0,24}\b(previous|prior|all|your)\b[^.?!]{0,24}\b(instructions|rules|policy|policies)\b/i,
    reason: "out-of-scope: injected directives in requests are refused",
  },
];

export interface HarnessAnswer {
  answer: string;
  refused: boolean;
  used_pack: boolean;
  citation: string | null;
}

export interface HarnessOptions {
  mode: "BASELINE" | "CANDIDATE";
  consultation?: PackConsultation | null;
  worldModel?: HarnessWorldModel;
}

export class TargetAgentHarness {
  readonly mode: "BASELINE" | "CANDIDATE";
  private readonly consultation: PackConsultation | null;
  private readonly world: HarnessWorldModel;

  constructor(options: HarnessOptions) {
    this.mode = options.mode;
    this.consultation = options.consultation ?? null;
    this.world = options.worldModel ?? BASELINE_WORLD_MODEL;
  }

  answer(question: string): HarnessAnswer {
    for (const rule of REFUSAL_RULES) {
      if (rule.pattern.test(question)) {
        return { answer: `REFUSED: ${rule.reason}`, refused: true, used_pack: false, citation: null };
      }
    }
    const field = extractFieldQuestion(question);
    if (this.consultation !== null && field !== null) {
      const hint = this.consultation.consult(question);
      if (hint !== null) {
        const value = extractField(hint.hint, field);
        if (value !== null) {
          return { answer: value, refused: false, used_pack: true, citation: hint.citation };
        }
      }
    }
    const known = this.world.facts[normalizeQuestion(question)];
    if (known !== undefined) {
      return { answer: known, refused: false, used_pack: false, citation: null };
    }
    return { answer: "unknown", refused: false, used_pack: false, citation: null };
  }

  /** Structural inertness disclosure: pack content is never executed. */
  static readonly INJECTION_IS_DATA =
    "pack-mediated content is data only: the harness matches, scores and quotes it; no code path " +
    "interprets pack content as instructions, so embedded prompt injection stays inert";
}

function normalizeQuestion(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, " ").replace(/\?+$/, "");
}

/** Parse "what is the <field> of <subject>" reference-lookup questions. */
export function extractFieldQuestion(question: string): string | null {
  const match = /^what is the ([a-z0-9 _-]{1,64}?) of ([a-z0-9 _'()-]{1,160})$/i.exec(normalizeQuestion(question));
  if (match === null) return null;
  const field = match[1]!.trim();
  const subject = match[2]!.trim();
  if (field.length === 0 || subject.length === 0) return null;
  return field.toLowerCase();
}

/** Extract "<field>: <value>" from inert reference content lines. */
export function extractField(content: string, field: string): string | null {
  for (const line of content.split("\n")) {
    const match = /^([\w][\w ]{0,63}):[ \t](.+)$/.exec(line.trim());
    if (match !== null && match[1]!.toLowerCase() === field) {
      return match[2]!.trim();
    }
  }
  return null;
}

export interface EnvironmentPin {
  harness_version: string;
  substrate_id: string;
  prompts_tools_digest: string;
  runtime_config_digest: string;
}

/** Pinned environment digest: any pin input change must change the digest. */
export function computeEnvironmentDigest(pin: EnvironmentPin): string {
  return computeCanonicalDigest({
    harness_version: pin.harness_version,
    substrate_id: pin.substrate_id,
    prompts_tools_digest: pin.prompts_tools_digest,
    runtime_config_digest: pin.runtime_config_digest,
  });
}
