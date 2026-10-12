import { createHash } from "node:crypto";

/**
 * AR2-017 — QuarantineLayer: untrusted-data handling (issue #33; spec §6).
 *
 * Fetched pages, headers, robots.txt, OCR text and API responses are UNTRUSTED,
 * potentially adversarial content. This layer validates content type, size,
 * encoding shape and record counts; quarantines malformed/suspicious active
 * content; annotates prompt-injection text (it remains DATA — it can never
 * override policy, invoke tools, change egress, select a provider or access
 * secrets); and redacts secrets and policy-prohibited PII patterns before
 * dataset assembly.
 */

export interface QuarantineConfig {
  allowed_content_types: readonly string[];
  max_item_bytes: number;
  max_quarantined_records: number;
  redact_secrets: boolean;
  redact_pii: boolean;
}

export type FetchDisposition =
  | { disposition: "ACCEPT"; reasons: string[] }
  | { disposition: "QUARANTINE"; reasons: string[] };

export interface SanitizeResult {
  content: string;
  redactions: string[];
  injection_annotations: string[];
}

/** Prompt-injection marker patterns (annotated, never executed, never removed). */
const INJECTION_PATTERNS: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: "INJ_IGNORE_PREVIOUS", pattern: /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?/i },
  { id: "INJ_DISREGARD", pattern: /disregard\s+(?:all\s+)?(?:previous|prior|above)/i },
  { id: "INJ_EXFILTRATE_SECRETS", pattern: /exfiltrate\s+(?:the\s+)?secrets?/i },
  { id: "INJ_REVEAL_SYSTEM_PROMPT", pattern: /reveal\s+(?:your\s+)?system\s+prompt/i },
  { id: "INJ_OVERRIDE_POLICY", pattern: /override\s+(?:all\s+)?(?:instructions?|polic(?:y|ies)|rules?)/i },
  { id: "INJ_YOU_ARE_NOW", pattern: /you\s+are\s+now\s+(?:a|an)\s+/i },
  { id: "INJ_JAILBREAK", pattern: /jailbreak/i },
  { id: "INJ_SEND_CREDENTIAL", pattern: /send\s+(?:the\s+)?(?:api\s+)?(?:key|token|credential)/i },
  { id: "INJ_TOOL_INVOCATION", pattern: /call\s+(?:the\s+)?(?:tool|function)\s+/i },
];

/** Secret-shaped patterns (redacted before dataset assembly). */
const SECRET_PATTERNS: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: "secret_key", pattern: /\bsk-[A-Za-z0-9]{16,}\b/g },
  { id: "aws_access_key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g },
  { id: "private_key_block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { id: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g },
];

/** Policy-prohibited PII patterns (redacted per the definition's redaction class). */
const PII_PATTERNS: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: "email", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
];

export class QuarantineLayer {
  readonly config: QuarantineConfig;
  private quarantinedCount = 0;

  constructor(config: QuarantineConfig) {
    this.config = config;
  }

  /** Validate a fetched response envelope (content type, size, shape). */
  inspectResponse(url: string, contentType: string | null, bytes: number): FetchDisposition {
    const reasons: string[] = [];
    const type = contentType === null ? "" : contentType.split(";", 1)[0]!.trim().toLowerCase();
    if (!this.config.allowed_content_types.includes(type)) {
      reasons.push(`content type "${type || "(none)"}" is not allowed (allowed: ${this.config.allowed_content_types.join(", ")})`);
    }
    if (bytes > this.config.max_item_bytes) {
      reasons.push(`response of ${bytes} bytes exceeds the per-item cap ${this.config.max_item_bytes}`);
    }
    if (reasons.length === 0) return { disposition: "ACCEPT", reasons: [] };
    this.quarantinedCount += 1;
    return { disposition: "QUARANTINE", reasons };
  }

  /** Verify a UTF-8 decode succeeded without replacement characters piling up. */
  inspectBodyText(url: string, text: string): FetchDisposition {
    const reasons: string[] = [];
    if ((text.match(/\uFFFD/g) ?? []).length > 16) {
      reasons.push("body failed UTF-8 validation (excessive replacement characters)");
    }
    let controlCount = 0;
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      if (code <= 0x08 || (code >= 0x0e && code <= 0x1f)) controlCount += 1;
    }
    const controlRatio = controlCount / Math.max(1, text.length);
    if (controlRatio > 0.1) {
      reasons.push("body is likely binary/malformed active content");
    }
    if (reasons.length === 0) return { disposition: "ACCEPT", reasons: [] };
    this.quarantinedCount += 1;
    return { disposition: "QUARANTINE", reasons };
  }

  /** Whether quarantine overflow should fail the run (fail closed). */
  quarantineOverflow(): boolean {
    return this.quarantinedCount > this.config.max_quarantined_records;
  }

  quarantineCount(): number {
    return this.quarantinedCount;
  }

  /**
   * Sanitize text content: annotate injection markers (content stays inert
   * data), redact secret-shaped and policy-prohibited PII patterns.
   */
  sanitizeContent(text: string): SanitizeResult {
    let content = text;
    const redactions: string[] = [];
    const injection_annotations: string[] = [];
    for (const { id, pattern } of INJECTION_PATTERNS) {
      if (pattern.test(content)) injection_annotations.push(id);
      pattern.lastIndex = 0;
    }
    if (this.config.redact_secrets) {
      for (const { id, pattern } of SECRET_PATTERNS) {
        const before = content;
        content = content.replace(pattern, `[REDACTED:${id}]`);
        if (content !== before) redactions.push(id);
      }
    }
    if (this.config.redact_pii) {
      for (const { id, pattern } of PII_PATTERNS) {
        const before = content;
        content = content.replace(pattern, `[REDACTED:${id}]`);
        if (content !== before) redactions.push(id);
      }
    }
    return { content, redactions, injection_annotations };
  }

  /** Content hash for dedup + provenance (over the sanitized content). */
  static contentHash(content: string): string {
    return createHash("sha256").update(content, "utf8").digest("hex");
  }
}

/** The invariant the layer guarantees (exported for tests/docs). */
export const QUARANTINE_INVARIANT_RULE =
  "quarantine annotations and redactions are data transformations only: no fetched content can " +
  "override policy, invoke tools, change egress, select a provider or access secrets";
