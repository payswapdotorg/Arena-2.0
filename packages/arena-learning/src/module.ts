/**
 * arena-learning 模块清单：AR2-014 权利门控学习与 Agent Body/版本市场
 * （issue #16）。
 *
 * 冻结面消费：learningStateMachine（ES2.0 不变量 8，evaluateTransition +
 * SystemPublishLearning 命令）；AR2-007 证据材料作为溯源源。复用需要
 * 显式权利（fail-closed）；客户制品默认私有；既有证据不可变（修正 =
 * 追加）；认证绑定「测过的组合/策略/环境/范围」。依赖声明与
 * architecture-policy.yaml 一致；对外只暴露 contract.ts。
 */
export const arenaLearningModule = {
  id: "arena-learning",
  requires: ["arena-contracts", "arena-evidence"],
  provides: [
    "rights-grant-registry-fail-closed",
    "learning-proposal-versioned",
    "provenance-graph-immutable",
    "consent-and-scope-review",
    "agent-body-version-immutable",
    "composition-possession-metadata",
    "certification-digest-binding",
    "publication-via-frozen-machine",
    "deprecation-as-new-record",
  ],
  publicEntrypoints: ["contract.ts"],
} as const;
