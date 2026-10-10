import { z } from "zod";

/**
 * Arena 公共契约的基础类型与常量。
 * 本包是被 architecture guard 管理的模块：对外只暴露 contract.ts；
 * 其余文件属于模块内部实现，包外禁止深引用。
 */

/** 契约族版本（escalation-lifecycle.md 的 ES2.0）。 */
export const CONTRACT_VERSION = "ES2.0" as const;

/** 冻结语料版本：AR2-001 冻结发布号，additive-only 直到下一个 major。 */
export const CONTRACT_CORPUS_VERSION = "CF1.0" as const;

/** 证明与支付策略版本（spec/verification/proof-and-payment-policy.md）。 */
export const PROOF_POLICY_VERSION = "PVP1.0" as const;

/** 事件 schema 版本（EventEnvelope 的 schema_version 起始值）。 */
export const EVENT_SCHEMA_VERSION = "ES2.0-EV1" as const;

/** 通用 ID：以字母数字开头，允许 _ -，长度 8..128。 */
export const arenaIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/, "id must match ^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$");

export type ArenaId = z.infer<typeof arenaIdSchema>;

/** 非空短文本（标题、名称等）。 */
export const nonEmptyShortSchema = z.string().min(1).max(200);

/** 非空中等文本（描述、理由等）。 */
export const nonEmptyMediumSchema = z.string().min(1).max(2000);

/** sha256 hex 摘要。 */
export const digestSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "digest must be lowercase sha256 hex (64 chars)");

export type ArenaDigest = z.infer<typeof digestSchema>;

/** ISO-8601 UTC 时间戳（秒或毫秒精度，必须带 Z）。 */
export const isoTimestampSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/,
    "timestamp must be ISO-8601 UTC ending in Z",
  );

export type ArenaTimestamp = z.infer<typeof isoTimestampSchema>;

/** ISO 日期（观察期等按天计的时长）。 */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

/** 语义化版本（粗粒度校验：major.minor.patch 可带预发布后缀）。 */
export const semverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, "must be semver-like major.minor.patch");

/** ISO-4217 货币代码。 */
export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, "currency must be ^[A-Z]{3}$");

/** 正整数（>=1）。 */
export const positiveIntSchema = z.number().int().min(1);

/** 非负整数（>=0）。 */
export const nonNegativeIntSchema = z.number().int().min(0);

/** 正金额（>0，最小单位按浮点表示；引擎侧由 port 决定精度策略）。 */
export const positiveAmountSchema = z.number().positive().finite();

/** 非负金额（>=0）。 */
export const nonNegativeAmountSchema = z.number().min(0).finite();

/** 风险等级。 */
export const riskTierSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

/** 隐私档位。 */
export const privacyProfileSchema = z.enum(["PUBLIC", "TENANT", "CONFIDENTIAL", "REGULATED"]);

/** 保留档位。 */
export const retentionProfileSchema = z.enum(["STANDARD", "EXTENDED", "SHORT", "COMPLIANCE"]);

/** 证据脱敏等级（EventEnvelope/EvidenceEnvelope 共用）。 */
export const redactionClassSchema = z.enum(["public", "tenant", "reviewer_private", "operator"]);

/** 证明等级。 */
export const proofClassSchema = z.enum(["P0", "P1", "P2", "P3"]);

/** 脱敏等级证明用到的自由文本引用 ID。 */
export const referenceIdSchema = arenaIdSchema;
