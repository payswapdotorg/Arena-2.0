/**
 * arena-workbench 模块清单：AR2-003 requester/expert/reviewer workbench。
 * typed mock client（ROLE_IS_NOT_AUTHORIZATION 强制）+ requester cockpit 表单
 * （CF1.0 zod 客户端校验）+ 专家流（候选提交/结构化自评——经冻结 attempt
 * 状态机）+ reviewer/adjudicator 视图模型与屏（脱敏分区、自评非投票）
 * + 角色/透镜切换（仅展示）+ 四状态机视图登记表（1:1 派生、不发明状态）
 * + DEMO 标注 fixtures。依赖声明与 architecture-policy.yaml 一致；
 * 对外只暴露 contract.ts。
 */
export const arenaWorkbenchModule = {
  id: "arena-workbench",
  requires: ["arena-contracts"],
  provides: [
    "workbench-mock-client",
    "workbench-requester-form",
    "workbench-expert-flow",
    "workbench-reviewer-deck",
    "workbench-role-lens",
    "workbench-state-views",
    "workbench-demo-fixtures",
  ],
  publicEntrypoints: ["contract.ts"],
} as const;
