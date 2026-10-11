/**
 * arena-expert-arena 模块清单：AR2-009 Expert Arena —— 竞争轮、不可变
 * 候选版本、结构化作者自评、冲突筛查的独立评审、rubric 评分、quorum、
 * 裁定与轮结果选择（issue #11）。
 *
 * 只消费冻结面：contracts 状态机引擎 + 冻结命令枚举 + review_policy 字段；
 * AR2-007 evaluateProof/ProofDecision（同一预声明验证）；AR2-008
 * evaluateConflictOfInterest（共享冲突语义）。无独立支付权威
 * （支付 = 操作 id 引用，归 @arena/payment）。依赖声明与
 * architecture-policy.yaml 一致；对外只暴露 contract.ts。
 */
export const arenaExpertArenaModule = {
  id: "arena-expert-arena",
  requires: ["arena-contracts", "arena-evidence", "arena-matching"],
  provides: [
    "expert-arena-round-machine",
    "expert-arena-candidate-machine",
    "expert-arena-review-machine",
    "immutable-versioned-candidates",
    "structured-self-evaluation-never-a-vote",
    "conflict-checked-reviewer-assignment",
    "timeout-replacement-never-approval",
    "frozen-rubric-scoring",
    "independent-quorum-fail-closed",
    "adjudication-triggers-and-records",
    "proof-bound-round-outcome",
  ],
  publicEntrypoints: ["contract.ts"],
} as const;
