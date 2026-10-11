/**
 * arena-evidence 模块清单：AR2-007 证据捕获与证明级校验器管线。
 * 依赖声明与 architecture-policy.yaml 保持一致；对外只暴露 contract.ts。
 */
export const arenaEvidenceModule = {
  id: "arena-evidence",
  requires: ["arena-contracts"],
  provides: [
    "append-only-evidence-envelope-store",
    "evidence-binding-fail-closed-validation",
    "validator-registry",
    "bounded-validator-invocation-port",
    "validator-output-normalization",
    "proof-class-evaluator",
  ],
  publicEntrypoints: ["contract.ts"],
} as const;
