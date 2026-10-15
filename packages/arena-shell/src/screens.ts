/**
 * UIA-001 TL 集成 —— 屏登记桶（spec §3：「TL 集成提交把 ArenaShell 挂入
 * packages/web/src/main.tsx 与桌面渲染器」）。五个 lane 的 registration
 * 工厂 + 组合根适配器在此收口对外；语义变更需要 TL 的 ACR。
 */
export { requesterRegistration } from "./screens/requester/registration.js";
export type { RequesterScreenDeps } from "./screens/requester/registration.js";
export {
  expertRegistration,
  mockAttemptsAdapter,
  bindingCommandAdapter,
} from "./screens/expert/registration.js";
export type { ExpertScreenDeps } from "./screens/expert/registration.js";
export {
  reviewerRegistration,
  mockDecksAdapter,
  bindingReviewerAdapters,
} from "./screens/reviewer/registration.js";
export type { ReviewerScreenDeps } from "./screens/reviewer/registration.js";
export { developerRegistration } from "./screens/developer/registration.js";
export {
  operationsRegistration,
  bindingAuditAdapter,
} from "./screens/operations/registration.js";
export type { OperationsScreenDeps } from "./screens/operations/registration.js";
