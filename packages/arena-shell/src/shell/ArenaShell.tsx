/**
 * ArenaShell —— 产品外壳的最小可编译骨架（Wave 0 冻结层）。
 *
 * 这是 Worker A 的重构起点，不是终态。冻结不变式（spec/ux/
 * arena-native-ui.md）：
 *   1. 导航只经 ArenaShellPort；屏永不自行改路由（§1.2）。
 *   2. 未注册屏 = 类型化拒绝，逐字渲染（§1.2）。
 *   3. 角色透镜仅展示（§1.3）；切镜头不改变任何可见 API 能力。
 *   4. 姿态条诚实展示 NOT_GO / test_mode / disabled（§2.3）。
 *   5. 产品名 = ARENA_PRODUCT_NAME；用户可见面零 ZCode 品牌（§2.1）。
 */
import { useState } from "react";
import {
  ARENA_DEFAULT_SCREEN,
  ARENA_PRODUCT_NAME,
  ARENA_RELEASE_POSTURE,
  ARENA_ROLE_LENSES,
  ARENA_SCREEN_IDS,
  isArenaScreenId,
  type ArenaNavigateOutcome,
  type ArenaRoleLens,
  type ArenaScreenHost,
  type ArenaScreenId,
  type ArenaShellPort,
  type ArenaSolutionWorkspaceSlot,
} from "../contract.js";
import { ArenaScreenRegistry } from "./registry.js";

export interface ArenaShellProps {
  registry: ArenaScreenRegistry;
  solutionWorkspace?: ArenaSolutionWorkspaceSlot;
  initialScreen?: ArenaScreenId;
  initialLens?: ArenaRoleLens;
}

/** 端口实现：唯一的状态迁移面（未注册屏拒绝 —— 诚实展示）。 */
function createPort(
  active: ArenaScreenId,
  setActive: (screen: ArenaScreenId) => void,
  registry: ArenaScreenRegistry,
): ArenaShellPort {
  return {
    navigate(screenId: ArenaScreenId): ArenaNavigateOutcome {
      if (!isArenaScreenId(screenId)) {
        return {
          kind: "refused",
          refusal: { kind: "unregistered_screen", screenId: String(screenId) },
        };
      }
      if (!registry.lookup(screenId)) {
        return {
          kind: "refused",
          refusal: { kind: "unregistered_screen", screenId },
        };
      }
      setActive(screenId);
      return { kind: "navigated", screen: screenId };
    },
    activeScreen(): ArenaScreenId {
      return active;
    },
  };
}

function refusalText(refusal: { kind: string; screenId?: string; reason?: string }): string {
  if (refusal.kind === "unregistered_screen") {
    return `Navigation refused — screen "${refusal.screenId}" is not registered in this shell.`;
  }
  return `Navigation refused — ${refusal.reason ?? "unavailable"}.`;
}

export function ArenaShell(props: ArenaShellProps) {
  const { registry, solutionWorkspace = null, initialScreen = ARENA_DEFAULT_SCREEN } = props;
  const [active, setActive] = useState<ArenaScreenId>(initialScreen);
  const [lens, setLens] = useState<ArenaRoleLens>(props.initialLens ?? "requester");
  const [notice, setNotice] = useState<string | null>(null);

  const port = createPort(active, setActive, registry);
  const registration = registry.lookup(active);
  const host: ArenaScreenHost = { port, lens };

  function onNavigate(screen: ArenaScreenId) {
    const outcome = port.navigate(screen);
    setNotice(outcome.kind === "refused" ? refusalText(outcome.refusal) : null);
  }

  return (
    <div className="arena-shell" data-arena-shell="">
      <nav className="arena-shell-nav" aria-label="Arena primary navigation">
        <div className="arena-shell-brand">{ARENA_PRODUCT_NAME}</div>
        {ARENA_SCREEN_IDS.map((screen) => (
          <button
            key={screen}
            type="button"
            className={
              screen === active
                ? "arena-shell-nav-item arena-shell-nav-item-active"
                : "arena-shell-nav-item"
            }
            aria-current={screen === active ? "page" : undefined}
            onClick={() => onNavigate(screen)}
          >
            {registry.lookup(screen)?.title ?? screen}
          </button>
        ))}
      </nav>
      <div className="arena-shell-main">
        {notice !== null && (
          <div className="arena-shell-notice" role="alert">
            {notice}
          </div>
        )}
        {registration ? (
          registration.render(host)
        ) : (
          <section className="arena-shell-refused" role="status">
            <h2>Screen not registered</h2>
            <p>{refusalText({ kind: "unregistered_screen", screenId: active })}</p>
            <p>
              The Arena shell displays unregistered screens honestly instead of hiding navigation.
            </p>
          </section>
        )}
      </div>
      <footer className="arena-shell-posture" aria-label="Release posture">
        <span>Release decision: {ARENA_RELEASE_POSTURE.releaseDecision}</span>
        <span>Finance: {ARENA_RELEASE_POSTURE.financeMode}</span>
        <span>Untrusted execution: {ARENA_RELEASE_POSTURE.untrustedExecution}</span>
        {solutionWorkspace === null ? null : null}
      </footer>
      <div className="arena-shell-role-switcher" aria-label="Role lens (presentation only)">
        {ARENA_ROLE_LENSES.map((role) => (
          <button
            key={role}
            type="button"
            aria-pressed={role === lens}
            onClick={() => setLens(role)}
          >
            {role}
          </button>
        ))}
      </div>
    </div>
  );
}
