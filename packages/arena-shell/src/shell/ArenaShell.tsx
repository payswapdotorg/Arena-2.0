/**
 * ArenaShell —— 产品外壳（Worker A 重构层，spec/ux/arena-native-ui.md）。
 *
 * 冻结不变式（违反即缺陷）：
 *   1. 导航只经 ArenaShellPort；屏永不自行改路由（§1.2）。
 *   2. 未注册屏 = 类型化拒绝，逐字渲染（§1.2）。
 *   3. 角色透镜仅展示（§1.3）；切镜头不改变任何可见 API 能力。
 *   4. 姿态条诚实展示 NOT_GO / test_mode / disabled（§2.3）。
 *   5. 产品名 = ARENA_PRODUCT_NAME；用户可见面零 ZCode 品牌（§2.1）。
 *   6. 键盘：rail 上 roving tabindex（方向键 + Home/End），焦点环画在
 *      包装层（全局 focus 重置下的继承技法），tab 序先品牌位、次 rail、
 *      再主体、末透镜与姿态（§A3）。
 *   7. 响应式：>=960px 轨道展开；<960px 轨道收成顶部紧凑条，390x844
 *      无横向溢出；标签长度宽容（i18n 长词安全）（§A3）。
 */
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
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
  type ArenaScreenRegistration,
  type ArenaShellPort,
  type ArenaSolutionWorkspaceSlot,
} from "../contract.js";
import { ArenaWordmark } from "../identity/wordmark.js";
import { ArenaPostureBar } from "../identity/statePatterns.js";
import {
  firstScreen,
  hashForScreen,
  lastScreen,
  nextScreen,
  refusalText,
  screenFromHash,
} from "../nav/model.js";
import { ArenaScreenRegistry } from "./registry.js";

export interface ArenaShellProps {
  registry: ArenaScreenRegistry;
  /** 解决方案工作台挂槽（TL 集成注入；lanes 期间 null = 诚实不可用）。 */
  solutionWorkspace?: ArenaSolutionWorkspaceSlot;
  initialScreen?: ArenaScreenId;
  initialLens?: ArenaRoleLens;
  /** 键盘导航说明（aria-describedby 用）。 */
  announceKeyboardHints?: boolean;
}

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
        return { kind: "refused", refusal: { kind: "unregistered_screen", screenId } };
      }
      setActive(screenId);
      return { kind: "navigated", screen: screenId };
    },
    activeScreen(): ArenaScreenId {
      return active;
    },
  };
}

/** rail 键盘语义：方向键移动、Home/End 端点、Enter/Space 激活。 */
function railKeys(
  event: KeyboardEvent<HTMLButtonElement>,
  screen: ArenaScreenId,
): ArenaScreenId | null {
  switch (event.key) {
    case "ArrowDown":
    case "ArrowRight":
      return nextScreen(screen, 1);
    case "ArrowUp":
    case "ArrowLeft":
      return nextScreen(screen, -1);
    case "Home":
      return firstScreen();
    case "End":
      return lastScreen();
    default:
      return null;
  }
}

export function ArenaShell(props: ArenaShellProps) {
  const {
    registry,
    solutionWorkspace = null,
    initialScreen = ARENA_DEFAULT_SCREEN,
    initialLens = "requester",
  } = props;
  const resolvedInitial: ArenaScreenId = isArenaScreenId(initialScreen)
    ? initialScreen
    : ARENA_DEFAULT_SCREEN;
  const [notice, setNotice] = useState<string | null>(null);
  // 深链一次性解析（#/<screenId>）—— 未知 hash 诚实忽略，绝不猜测。
  const [hashInitial] = useState(() =>
    typeof window === "undefined" ? null : screenFromHash(window.location.hash),
  );
  // UIA-001 TL 集成修复：深链结果并入「活」导航态（浏览器旅程抓到的
  // 缺陷 —— 此前 effectiveActive 是从不更新的第二 state：点击导航更新
  // active 而渲染读 effectiveActive，深链只在挂载时生效、点击永不变屏；
  // SSR 测试单帧渲染测不出该类缺陷）。
  const [active, setActive] = useState<ArenaScreenId>(() => hashInitial ?? resolvedInitial);
  const [lens, setLens] = useState<ArenaRoleLens>(
    isArenaScreenLens(initialLens) ? initialLens : "requester",
  );
  const railRef = useRef<HTMLDivElement | null>(null);
  const hintsId = useId();

  const effectiveActive = active;

  const port = createPort(effectiveActive, setActive, registry);
  const registration = registry.lookup(effectiveActive);
  const host: ArenaScreenHost = { port, lens };

  function onNavigate(screen: ArenaScreenId) {
    const outcome = port.navigate(screen);
    setNotice(outcome.kind === "refused" ? refusalText(outcome.refusal) : null);
    if (typeof window !== "undefined") {
      // hash 是端口实现的一部分（shell 拥有 URL；屏从不读写）
      window.location.hash = hashForScreen(screen);
    }
  }

  function onRailKeyDown(event: KeyboardEvent<HTMLButtonElement>, screen: ArenaScreenId) {
    const target = railKeys(event, screen);
    if (target === null) return;
    event.preventDefault();
    const el = railRef.current?.querySelector<HTMLButtonElement>(
      `[data-arena-nav-item="${target}"]`,
    );
    el?.focus();
    // 移动即导航（roving tabindex 的单键语义）
    onNavigate(target);
  }

  return (
    <div className="arena-shell" data-arena-shell="">
      <a className="arena-skip-link" href="#arena-main">
        Skip to main content
      </a>
      <nav className="arena-shell-nav" aria-label="Arena primary navigation">
        <div className="arena-shell-brand">
          <ArenaWordmark size={22} />
        </div>
        <div
          className="arena-shell-rail"
          ref={railRef}
          role="tablist"
          aria-orientation="vertical"
          aria-describedby={props.announceKeyboardHints ? hintsId : undefined}
        >
          {ARENA_SCREEN_IDS.map((screen) => {
            const reg = registry.lookup(screen);
            const isActive = screen === effectiveActive;
            return (
              <button
                key={screen}
                type="button"
                id={`arena-nav-${screen}`}
                role="tab"
                aria-selected={isActive}
                aria-current={isActive ? "page" : undefined}
                aria-controls="arena-main"
                tabIndex={isActive ? 0 : -1}
                data-arena-nav-item={screen}
                data-arena-nav-active={isActive ? "true" : undefined}
                className={
                  isActive
                    ? "arena-shell-nav-item arena-shell-nav-item-active"
                    : "arena-shell-nav-item"
                }
                onClick={() => onNavigate(screen)}
                onKeyDown={(e) => onRailKeyDown(e, screen)}
              >
                <span className="arena-shell-nav-label">{reg?.title ?? screen}</span>
                {!reg ? <span className="arena-shell-nav-unregistered">not registered</span> : null}
              </button>
            );
          })}
          {props.announceKeyboardHints ? (
            <p id={hintsId} className="arena-shell-nav-hint">
              Arrow keys move between screens; Enter activates the focused screen.
            </p>
          ) : null}
        </div>
      </nav>
      <div className="arena-shell-body">
        {notice !== null ? (
          <div className="arena-shell-notice" role="alert">
            {notice}
          </div>
        ) : null}
        <main id="arena-main" className="arena-shell-main" aria-live="polite" tabIndex={0}>
          {registration ? (
            registration.render(host)
          ) : (
            <section className="arena-shell-refused" role="status">
              <h2>Screen not registered</h2>
              <p>{refusalText({ kind: "unregistered_screen", screenId: effectiveActive })}</p>
              <p>
                The Arena shell displays unregistered screens honestly instead of hiding navigation.
              </p>
              {solutionWorkspace === null ? null : (
                <p className="arena-shell-solution-note">
                  The solution workspace is mounted only inside expert task context.
                </p>
              )}
            </section>
          )}
        </main>
        <footer className="arena-shell-footnote">
          <ArenaPostureBar />
          <span className="arena-shell-product">{ARENA_PRODUCT_NAME}</span>
        </footer>
      </div>
      <aside
        className="arena-shell-role-switcher"
        aria-label="Role lens (presentation only — never an authorization)"
      >
        {ARENA_ROLE_LENSES.map((role) => (
          <button
            key={role}
            type="button"
            aria-pressed={role === lens}
            data-arena-lens={role}
            className={role === lens ? "arena-lens arena-lens-active" : "arena-lens"}
            onClick={() => setLens(role)}
          >
            {role}
          </button>
        ))}
      </aside>
    </div>
  );
}

function isArenaScreenLens(value: unknown): value is ArenaRoleLens {
  return typeof value === "string" && (ARENA_ROLE_LENSES as readonly string[]).includes(value);
}

/** 注册表构造糖（挂接与测试用；屏 registration 由各 lane 提供）。 */
export function shellFromRegistrations(
  registrations: readonly ArenaScreenRegistration[],
): ArenaScreenRegistry {
  const registry = new ArenaScreenRegistry();
  for (const r of registrations) registry.register(r);
  return registry;
}

export type { ReactNode };
