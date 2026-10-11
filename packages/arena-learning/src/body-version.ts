import { createHash } from "node:crypto";
import { z } from "zod";
import { arenaIdSchema, digestSchema, isoTimestampSchema } from "@arena/contracts";
import { evaluateTransition, learningStateMachine, type LearningState } from "@arena/contracts";
import { nonEmptyMedium } from "./rights.js";
import type { RightsEvaluation } from "./rights.js";

/**
 * AR2-014 — 不可变 Agent Body 版本 + 组合/持有元数据 + 认证绑定 +
 * 发布/弃用编排（issue #16）。
 *
 * 冻结纪律：
 * - BodyVersion 不可变：新版本 = 新记录（版本号单调递增）；弃用是标记
 *   （deprecation），被弃用版本的历史证据原样保留；
 * - 认证四元组绑定：tested composition digest + policy digest +
 *   environment digest + scope digest —— 认证钉死「测过的就是发布的」；
 * - 发布/弃用只经冻结 learningStateMachine（evaluateTransition +
 *   SystemPublishLearning；不变量 8 五守卫合取在 APPROVED→PUBLISHED）。
 */

export const compositionPartSchema = z
  .object({
    part_kind: z.enum(["knowledge_pack", "tool_rule", "connector_preset", "body_base"]),
    part_id: arenaIdSchema,
    part_version: z.number().int().positive(),
    part_digest: digestSchema,
  })
  .strict();

export const bodyVersionSchema = z
  .object({
    body_id: arenaIdSchema,
    version: z.number().int().positive(),
    composition: z.array(compositionPartSchema).min(1).max(64),
    possession_metadata: z
      .object({
        owner_tenant_id: arenaIdSchema,
        /** 市场分发许可（默认 tenant-only —— 私有默认）。 */
        distribution: z.enum(["tenant_only", "marketplace_listed"]),
        derived_from_body_version: z
          .object({ body_id: arenaIdSchema, version: z.number().int().positive() })
          .strict()
          .nullable(),
      })
      .strict(),
    content_digest: digestSchema,
    created_at: isoTimestampSchema,
    deprecated_at: isoTimestampSchema.nullable(),
    deprecation_reason: nonEmptyMedium.nullable(),
  })
  .strict();

export type CompositionPart = z.infer<typeof compositionPartSchema>;
export type BodyVersion = z.infer<typeof bodyVersionSchema>;

export const certificationSchema = z
  .object({
    certification_id: arenaIdSchema,
    body_id: arenaIdSchema,
    body_version: z.number().int().positive(),
    tested_composition_digest: digestSchema,
    policy_digest: digestSchema,
    environment_digest: digestSchema,
    scope_digest: digestSchema,
    certified_at: isoTimestampSchema,
  })
  .strict();

export type Certification = z.infer<typeof certificationSchema>;

export type CertificationCheck =
  | { kind: "BINDS"; certification: Certification }
  | {
      kind: "MISMATCH";
      issues: ReadonlyArray<{ field: string; rule: string }>;
    };

/** 认证绑定校验：发布的版本必须与测试过的组合/策略/环境/范围逐摘要相等。 */
export function verifyCertificationBinding(input: {
  certification: Certification;
  body: BodyVersion;
  published_policy_digest: string;
  published_environment_digest: string;
  published_scope_digest: string;
}): CertificationCheck {
  const issues: Array<{ field: string; rule: string }> = [];
  if (input.certification.body_id !== input.body.body_id) {
    issues.push({ field: "body_id", rule: "certification was issued for a different body" });
  }
  if (input.certification.body_version !== input.body.version) {
    issues.push({ field: "body_version", rule: "certification binds the exact tested version" });
  }
  const compositionDigest = compositionDigestOf(input.body);
  if (input.certification.tested_composition_digest !== compositionDigest) {
    issues.push({
      field: "tested_composition_digest",
      rule: "published composition differs from the tested composition (certification does not transfer)",
    });
  }
  if (input.certification.policy_digest !== input.published_policy_digest) {
    issues.push({ field: "policy_digest", rule: "policy changed since certification" });
  }
  if (input.certification.environment_digest !== input.published_environment_digest) {
    issues.push({ field: "environment_digest", rule: "environment changed since certification" });
  }
  if (input.certification.scope_digest !== input.published_scope_digest) {
    issues.push({ field: "scope_digest", rule: "scope changed since certification" });
  }
  if (issues.length > 0) return { kind: "MISMATCH", issues };
  return { kind: "BINDS", certification: input.certification };
}

/** 组合摘要（确定序拼接 —— 版本不可变 ⇒ 摘要稳定）。 */
export function compositionDigestOf(body: BodyVersion): string {
  const material = body.composition
    .map((part) => `${part.part_kind}:${part.part_id}:${part.part_version}:${part.part_digest}`)
    .sort()
    .join("|");
  return createHash("sha256").update(material).digest("hex");
}

export class BodyVersionRegistry {
  private readonly bodies = new Map<string, BodyVersion[]>();

  publishVersion(
    input: unknown,
  ):
    | { kind: "RECORDED"; body: BodyVersion }
    | { kind: "REJECTED"; issues: ReadonlyArray<{ field: string; rule: string }> } {
    const parsed = bodyVersionSchema.safeParse(input);
    if (!parsed.success) {
      return {
        kind: "REJECTED",
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
          rule: issue.message,
        })),
      };
    }
    const body = parsed.data;
    const history = this.bodies.get(body.body_id) ?? [];
    if (body.deprecated_at !== null) {
      return {
        kind: "REJECTED",
        issues: [
          {
            field: "deprecated_at",
            rule: "new versions are recorded live; deprecation marks existing versions",
          },
        ],
      };
    }
    if (history.length > 0) {
      const latest = history[history.length - 1];
      if (latest !== undefined && latest.version >= body.version) {
        return {
          kind: "REJECTED",
          issues: [
            { field: "version", rule: "body versions are immutable and monotonically increasing" },
          ],
        };
      }
    }
    history.push(body);
    this.bodies.set(body.body_id, history);
    return { kind: "RECORDED", body };
  }

  /** 弃用：标记既有版本（历史保留；不可弃用两次）。 */
  deprecate(input: {
    body_id: string;
    version: number;
    deprecated_at: string;
    reason: string;
  }): { kind: "DEPRECATED" } | { kind: "NOT_FOUND" | "ALREADY_DEPRECATED" } {
    const history = this.bodies.get(input.body_id);
    const target = history?.find((candidate) => candidate.version === input.version);
    if (target === undefined) return { kind: "NOT_FOUND" };
    if (target.deprecated_at !== null) return { kind: "ALREADY_DEPRECATED" };
    target.deprecated_at = input.deprecated_at;
    target.deprecation_reason = input.reason;
    return { kind: "DEPRECATED" };
  }

  versions(bodyId: string): readonly BodyVersion[] {
    return [...(this.bodies.get(bodyId) ?? [])].map((body) => ({ ...body }));
  }

  current(bodyId: string): BodyVersion | null {
    const history = this.bodies.get(bodyId);
    return history !== undefined && history.length > 0
      ? (history[history.length - 1] ?? null)
      : null;
  }
}

export type PublicationStepOutcome =
  | {
      kind: "TRANSITIONED";
      from: LearningState;
      to: LearningState;
      guards_passed: readonly string[];
    }
  | {
      kind: "BLOCKED";
      code: "ARENA_INVALID_TRANSITION" | "ARENA_INVARIANT_VIOLATION";
      failed_guards: readonly string[];
    };

/** 发布流（唯一通道：冻结 learningStateMachine + SystemPublishLearning）。 */
export class LearningPublicationFlow {
  private state: LearningState = learningStateMachine.initial;

  current(): LearningState {
    return this.state;
  }

  step(facts: Record<string, boolean>): PublicationStepOutcome {
    const evaluation = evaluateTransition(
      learningStateMachine,
      this.state,
      "SystemPublishLearning",
      facts,
    );
    if (!evaluation.ok) {
      return { kind: "BLOCKED", code: evaluation.code, failed_guards: evaluation.failed_guards };
    }
    const from = this.state;
    this.state = evaluation.to;
    return { kind: "TRANSITIONED", from, to: this.state, guards_passed: [] };
  }

  /** 权利 → 守卫事实（RIGHTS_MISSING ⇒ rights_verified=false —— fail-closed）。 */
  static rightsFact(rights: RightsEvaluation): boolean {
    return rights.kind === "RIGHTS_GRANTED";
  }
}

export const BODY_MARKETPLACE_DISCLOSURE =
  "Agent Body versions are immutable records with monotonic versions; possession metadata defaults " +
  "to tenant_only distribution; certification binds the exact tested composition, policy, environment " +
  "and scope by digest — a changed quadruple invalidates the binding; publication and deprecation " +
  "flow only through the frozen learningStateMachine (invariant-8 five-guard conjunction at publication)";
