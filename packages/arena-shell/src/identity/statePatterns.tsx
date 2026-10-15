/**
 * Arena 状态模式套件（spec/ux/arena-native-ui.md §2.1/§2.3）：
 * 欢迎 / 空态 / 加载 / 错误 —— 全部 Arena 品牌、克制、运营型；
 * 文案从不暗示生产隔离、真实支付或发布 GO。
 */
import type { ReactNode } from "react";
import { ARENA_PRODUCT_NAME, ARENA_RELEASE_POSTURE } from "../contract.js";
import { ArenaWordmark } from "./wordmark.js";

export function ArenaWelcome(): ReactNode {
  return (
    <section className="arena-state arena-welcome" data-arena-state="welcome">
      <ArenaWordmark size={44} />
      <h1 className="arena-state-title">{ARENA_PRODUCT_NAME}</h1>
      <p className="arena-state-body">
        The human-expert escalation and capability-acquisition platform: submit a capability gap,
        follow routing, evidence and verification, and receive a typed result.
      </p>
      <p className="arena-state-posture">
        Release decision: {ARENA_RELEASE_POSTURE.releaseDecision} · finance:{" "}
        {ARENA_RELEASE_POSTURE.financeMode} · untrusted execution:{" "}
        {ARENA_RELEASE_POSTURE.untrustedExecution}
      </p>
    </section>
  );
}

export interface ArenaEmptyProps {
  /** 空态主体（领域语义，如 "No escalations yet"）。 */
  body: string;
  /** 可选补充（下一步指引），不引导特权操作。 */
  hint?: string;
}

export function ArenaEmpty({ body, hint }: ArenaEmptyProps): ReactNode {
  return (
    <section className="arena-state arena-empty" data-arena-state="empty">
      <h2 className="arena-state-title">{body}</h2>
      {hint ? <p className="arena-state-body">{hint}</p> : null}
    </section>
  );
}

export function ArenaLoading({ label = "Loading" }: { label?: string }): ReactNode {
  return (
    <section className="arena-state arena-loading" data-arena-state="loading" role="status">
      <span className="arena-loading-dot" aria-hidden="true" />
      <span className="arena-state-body">{label}…</span>
    </section>
  );
}

export interface ArenaErrorProps {
  /** 类型化错误文本 —— 逐字渲染，绝不软化。 */
  detail: string;
  /** 可选重试 affordance 的回调。 */
  onRetry?: () => void;
}

export function ArenaError({ detail, onRetry }: ArenaErrorProps): ReactNode {
  return (
    <section className="arena-state arena-error" data-arena-state="error" role="alert">
      <h2 className="arena-state-title">Something failed</h2>
      <p className="arena-state-body">{detail}</p>
      {onRetry ? (
        <button type="button" className="arena-button" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </section>
  );
}

/** 姿态徽标条（shell 页脚与屏内复用）：真实姿态逐字。 */
export function ArenaPostureBar(): ReactNode {
  return (
    <div className="arena-posture" data-arena-posture="">
      <span>Release decision: {ARENA_RELEASE_POSTURE.releaseDecision}</span>
      <span>Finance: {ARENA_RELEASE_POSTURE.financeMode}</span>
      <span>Untrusted execution: {ARENA_RELEASE_POSTURE.untrustedExecution}</span>
    </div>
  );
}
