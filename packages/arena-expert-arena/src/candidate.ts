import { z } from "zod";
import { arenaIdSchema } from "@arena/contracts";
import { nonEmptyMedium as nonEmptyMediumSchema } from "./common.js";

/**
 * AR2-009 — 不可变候选版本 + 结构化作者自评（EA1.0 §2；issue #11）。
 *
 * 冻结纪律：
 * - 候选包在提交时冻结：新工作 = 新 revision 版本，旧版本保留（EA1.0 §1.4）；
 * - 自评是作者声明，不是独立验证：每个 criterion 翻译为可测声明 +
 *   met/partially_met/not_met/not_verifiable + 证据引用 + 置信度与理由 +
 *   假设/局限/已知失败模式/残余风险；
 * - \`never_an_independent_vote: true\` 是结构字面量（编译期即存在），
 *   quorum 消费方按类型排除 —— 自评永远不构成评审票（EA1.0 §2 尾段）。
 */

export const claimStatusSchema = z.enum(["met", "partially_met", "not_met", "not_verifiable"]);

export const selfEvaluationClaimSchema = z
  .object({
    criterion_id: arenaIdSchema,
    claim: nonEmptyMediumSchema,
    status: claimStatusSchema,
    evidence_refs: z.array(arenaIdSchema).max(16),
    confidence: z.number().min(0).max(1),
    rationale: nonEmptyMediumSchema,
  })
  .strict();

export const structuredSelfEvaluationSchema = z
  .object({
    claims: z.array(selfEvaluationClaimSchema).min(1).max(64),
    assumptions: z.array(nonEmptyMediumSchema).max(32),
    limitations: z.array(nonEmptyMediumSchema).max(32),
    known_failure_modes: z.array(nonEmptyMediumSchema).max(32),
    residual_risks: z.array(nonEmptyMediumSchema).max(32),
    validator_results: z
      .array(
        z
          .object({
            validator_id: arenaIdSchema,
            validator_version: nonEmptyMediumSchema,
            result: nonEmptyMediumSchema,
          })
          .strict(),
      )
      .max(16),
    /** 结构字面量：自评永远不是独立验证（编译期冻结）。 */
    never_an_independent_vote: z.literal(true),
  })
  .strict();

export const candidatePackageSchema = z
  .object({
    solution_artifacts: z
      .array(
        z
          .object({
            artifact_id: arenaIdSchema,
            digest: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .min(1)
      .max(64),
    declared_assumptions: z.array(nonEmptyMediumSchema).max(32),
    evidence_manifest: z.array(arenaIdSchema).max(64),
    validation_instructions: nonEmptyMediumSchema,
    limitations: z.array(nonEmptyMediumSchema).max(32),
    self_evaluation: structuredSelfEvaluationSchema,
  })
  .strict();

export type ClaimStatus = z.infer<typeof claimStatusSchema>;
export type StructuredSelfEvaluation = z.infer<typeof structuredSelfEvaluationSchema>;
export type CandidatePackage = z.infer<typeof candidatePackageSchema>;

export interface CandidateVersionRecord {
  candidate_id: string;
  round_id: string;
  author_expert_id: string;
  revision: number;
  submitted_at: string;
  package: CandidatePackage;
}

export type CandidateSubmitOutcome =
  | { kind: "SUBMITTED"; record: CandidateVersionRecord }
  | { kind: "REJECTED"; issues: ReadonlyArray<{ field: string; rule: string }> };

/** 单轮内的候选登记处（内存参考实现 —— 版本不可变、可追溯）。 */
export class CandidateRegistry {
  private readonly byCandidate = new Map<string, CandidateVersionRecord[]>();
  private readonly byRound = new Map<string, string[]>();

  constructor(
    private readonly now: () => string = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  ) {}

  /** 提交（或修订提交）一个不可变候选版本。 */
  submitCandidate(input: {
    round_id: string;
    author_expert_id: string;
    candidate_package: unknown;
    /** 修订目标（REVISION_REQUESTED 时必填）：新版本追加，旧版本保留。 */
    revises_candidate_id?: string | null;
  }): CandidateSubmitOutcome {
    const parsed = candidatePackageSchema.safeParse(input.candidate_package);
    if (!parsed.success) {
      return {
        kind: "REJECTED",
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
          rule: issue.message,
        })),
      };
    }
    const candidateId =
      input.revises_candidate_id === null || input.revises_candidate_id === undefined
        ? `cand_${input.round_id}_${input.author_expert_id}`
        : input.revises_candidate_id;
    const history = this.byCandidate.get(candidateId) ?? [];
    const record: CandidateVersionRecord = {
      candidate_id: candidateId,
      round_id: input.round_id,
      author_expert_id: input.author_expert_id,
      revision: history.length + 1,
      submitted_at: this.now(),
      package: parsed.data,
    };
    history.push(record);
    this.byCandidate.set(candidateId, history);
    const roundCandidates = this.byRound.get(input.round_id) ?? [];
    if (!roundCandidates.includes(candidateId)) {
      roundCandidates.push(candidateId);
      this.byRound.set(input.round_id, roundCandidates);
    }
    return { kind: "SUBMITTED", record };
  }

  /** 全部版本（ oldest → newest ）—— 只读快照。 */
  versions(candidateId: string): readonly CandidateVersionRecord[] {
    return [...(this.byCandidate.get(candidateId) ?? [])];
  }

  /** 当前（最新）版本。 */
  current(candidateId: string): CandidateVersionRecord | null {
    const history = this.byCandidate.get(candidateId);
    return history !== undefined && history.length > 0
      ? (history[history.length - 1] ?? null)
      : null;
  }

  /** 一轮内的候选 id（提交序）。 */
  candidatesOfRound(roundId: string): readonly string[] {
    return [...(this.byRound.get(roundId) ?? [])];
  }

  /** 结构性证明材料：全部候选的自评都携带 never_an_independent_vote: true。 */
  allSelfEvaluationsMarkedNeverVote(roundId: string): boolean {
    return this.candidatesOfRound(roundId).every((candidateId) => {
      const record = this.current(candidateId);
      return record !== null && record.package.self_evaluation.never_an_independent_vote === true;
    });
  }
}

export const SELF_EVALUATION_DISCLOSURE =
  "Structured author self-evaluation is the author's claim, not independent verification: " +
  "useful for transparency, review routing and evidence context, never a reviewer vote, " +
  "never quorum, never certification, never payout-controlling (EA1.0 §2)";
