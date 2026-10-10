/**
 * AR2-003 — 角色/透镜切换（验收场景 4）。
 *
 * 冻结规则 ROLE_IS_NOT_AUTHORIZATION_RULE（architecture-lock）：
 * workbench 的 role 只是「透镜」（决定展示哪些屏），永远不是授权。
 * 授权由服务端从认证凭据推导（AR2-002 DEMO auth adapter 同语义）；
 * mock client 的每一次调用都携带 principal（tenant/user），从不读取 UI role。
 * 测试断言：role 切换不改变任何 client 调用路径或服务端可见行为。
 */

export const ROLE_IS_NOT_AUTHORIZATION_RULE =
  "the workbench role/lens is presentation ONLY: it selects which screens are shown, " +
  "never what is allowed; every authorization decision derives from the server-side " +
  "principal (tenant/user from credentials), and client calls never receive the UI role";

/** workbench 透镜（展示面；与领域角色枚举解耦——领域角色属 CF1.0 契约）。 */
export const WORKBENCH_LENSES = ["requester", "expert", "reviewer", "adjudicator"] as const;

export type WorkbenchLens = (typeof WORKBENCH_LENSES)[number];

export interface LensView {
  lens: WorkbenchLens;
  label: string;
  description: string;
}

/** 每个透镜可见的屏（仅展示；不构成任何权限声明）。 */
export const LENS_VIEWS: Readonly<Record<WorkbenchLens, LensView>> = {
  requester: {
    lens: "requester",
    label: "Requester cockpit",
    description:
      "create and track escalations (acceptance criteria, proof policy, budget, constraints)",
  },
  expert: {
    lens: "expert",
    label: "Expert workbench",
    description: "queue, attempt workspace, candidate submission and structured self-evaluation",
  },
  reviewer: {
    lens: "reviewer",
    label: "Reviewer screens",
    description:
      "criterion outcomes and verification trail with reviewer-private redaction classes",
  },
  adjudicator: {
    lens: "adjudicator",
    label: "Adjudicator screens",
    description: "dispute and adjudication views (slice 2)",
  },
};

/** 切换器视图模型：可用透镜 + 当前选择（组件层只渲染这个）。 */
export interface RoleSwitcherModel {
  available: readonly WorkbenchLens[];
  selected: WorkbenchLens;
}

export function roleSwitcherModel(selected: WorkbenchLens): RoleSwitcherModel {
  return { available: WORKBENCH_LENSES, selected };
}

export function isWorkbenchLens(value: unknown): value is WorkbenchLens {
  return typeof value === "string" && (WORKBENCH_LENSES as readonly string[]).includes(value);
}
