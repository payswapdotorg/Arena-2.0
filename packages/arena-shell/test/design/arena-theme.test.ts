import assert from "node:assert/strict";
import test from "node:test";
import {
  applyArenaTheme,
  observeArenaTheme,
  resolveArenaTheme,
  type ArenaThemeObserver,
} from "../../src/design/arenaTheme.js";

/**
 * UIA-005 — 主题模块单元测试（node:test；零 DOM —— 模块按注入约束收一切
 * 依赖，stub 注入即可覆盖全部分支，见 src/design/arenaTheme.ts 的 docblock）。
 */

function classListOf(classes: string[]): { contains(token: string): boolean } {
  const set = new Set(classes);
  return { contains: (token: string) => set.has(token) };
}

// ---- 解析器真值表（纯函数、全定义、确定性） -------------------------------

test("resolver truth table: host classes resolve in precedence order (dark > zai-light > zai-dark)", () => {
  assert.equal(resolveArenaTheme({ classList: classListOf(["dark"]), systemDark: false }), "dark");
  assert.equal(resolveArenaTheme({ classList: classListOf(["dark"]), systemDark: true }), "dark");
  // dark 优先于 theme-zai-light（宿主已解析为深色时以深色为准）。
  assert.equal(
    resolveArenaTheme({ classList: classListOf(["dark", "theme-zai-light"]), systemDark: false }),
    "dark",
  );
  assert.equal(
    resolveArenaTheme({ classList: classListOf(["theme-zai-light"]), systemDark: true }),
    "light",
  );
  assert.equal(
    resolveArenaTheme({ classList: classListOf(["theme-zai-light"]), systemDark: false }),
    "light",
  );
  // theme-zai-light 优先于 theme-zai-dark（同时出现时取浅色变体）。
  assert.equal(
    resolveArenaTheme({
      classList: classListOf(["theme-zai-light", "theme-zai-dark"]),
      systemDark: true,
    }),
    "light",
  );
  assert.equal(
    resolveArenaTheme({ classList: classListOf(["theme-zai-dark"]), systemDark: false }),
    "dark",
  );
  assert.equal(
    resolveArenaTheme({ classList: classListOf(["theme-zai-dark"]), systemDark: true }),
    "dark",
  );
  assert.equal(
    resolveArenaTheme({ classList: classListOf(["dark", "theme-zai-dark"]), systemDark: false }),
    "dark",
  );
});

test("resolver truth table: no host classes → system preference fallback", () => {
  assert.equal(resolveArenaTheme({ classList: classListOf([]), systemDark: true }), "dark");
  assert.equal(resolveArenaTheme({ classList: classListOf([]), systemDark: false }), "light");
});

test("resolver ignores classes outside the host theme vocabulary (no guessing)", () => {
  assert.equal(
    resolveArenaTheme({ classList: classListOf(["theme-zai"]), systemDark: false }),
    "light",
  );
  assert.equal(
    resolveArenaTheme({ classList: classListOf(["arena-shell"]), systemDark: true }),
    "dark",
  );
});

test("resolver is pure and deterministic (same input, same output)", () => {
  const input = { classList: classListOf(["theme-zai-light", "unrelated"]), systemDark: true };
  assert.equal(resolveArenaTheme(input), "light");
  assert.equal(resolveArenaTheme(input), "light");
});

// ---- 落属性器 ----------------------------------------------------------------

test("applier sets data-arena-theme verbatim on the target", () => {
  const calls: Array<{ name: string; value: string }> = [];
  const target = {
    setAttribute(name: string, value: string): void {
      calls.push({ name, value });
    },
  };
  applyArenaTheme(target, "light");
  applyArenaTheme(target, "dark");
  assert.deepEqual(calls, [
    { name: "data-arena-theme", value: "light" },
    { name: "data-arena-theme", value: "dark" },
  ]);
});

// ---- 观察工厂（注入 stub；回调按模块 docblock 的组合根配方接线） ----------

interface RecordedAttribute {
  name: string;
  value: string;
}

/** 可变 stub target：可翻转的 class 集合 + setAttribute 记录器。 */
function createStubTarget(initialClasses: string[]) {
  const classes = new Set(initialClasses);
  const calls: RecordedAttribute[] = [];
  return {
    calls,
    classList: { contains: (token: string) => classes.has(token) },
    setAttribute(name: string, value: string): void {
      calls.push({ name, value });
    },
    setClasses(next: string[]): void {
      classes.clear();
      for (const token of next) {
        classes.add(token);
      }
    },
    themeCalls(): RecordedAttribute[] {
      return calls.filter((call) => call.name === "data-arena-theme");
    },
    lastTheme(): string | null {
      const themeCalls = this.themeCalls();
      return themeCalls.length === 0 ? null : (themeCalls[themeCalls.length - 1]?.value ?? null);
    },
  };
}

interface RegisteredObservation {
  target: unknown;
  options: { attributes: boolean; attributeFilter: readonly string[] };
}

/**
 * 观察注入 stub：镜像浏览器组合根的接线配方（arenaTheme.ts docblock）——
 * observe 包装一个 class 属性观察器，其回调用模块导出的纯函数重解析 + 重落
 * 属性；stub 捕获该回调供测试投递，并以 connected 标志建模 MutationObserver
 * 的投递语义（disconnect 之后不再投递）。
 */
function createObservationHarness(initialClasses: string[], initialSystemDark: boolean) {
  const target = createStubTarget(initialClasses);
  let systemDark = initialSystemDark;
  let registration: RegisteredObservation | null = null;
  let disconnectCalls = 0;
  let connected = true;
  let callback: (() => void) | null = null;
  const deps = {
    target,
    systemDark: (): boolean => systemDark,
    observe(
      observedTarget: unknown,
      options: { attributes: boolean; attributeFilter: readonly string[] },
    ): { disconnect(): void } {
      registration = { target: observedTarget, options };
      callback = (): void => {
        applyArenaTheme(
          target,
          resolveArenaTheme({ classList: target.classList, systemDark: deps.systemDark() }),
        );
      };
      return {
        disconnect: (): void => {
          connected = false;
          disconnectCalls += 1;
        },
      };
    },
  };
  return {
    deps,
    target,
    setSystemDark(next: boolean): void {
      systemDark = next;
    },
    registration: (): RegisteredObservation | null => registration,
    disconnectCallCount: (): number => disconnectCalls,
    /** 模拟一次宿主 class 变更送达观察器（disconnect 后不送达）。 */
    deliver(): void {
      if (connected) {
        callback?.();
      }
    },
  };
}

test("observer factory applies immediately and registers a class-only attribute observer", () => {
  const harness = createObservationHarness(["theme-zai-light"], true);
  const handle: ArenaThemeObserver = observeArenaTheme(harness.deps);
  // 立即 apply（浅色变体优先于系统深色偏好）。
  assert.equal(harness.target.lastTheme(), "light");
  assert.equal(harness.target.themeCalls().length, 1);
  // 注册参数：只观察 class 属性。
  const registration = harness.registration();
  assert.ok(registration !== null, "deps.observe must have been called");
  assert.equal(registration.target, harness.deps.target);
  assert.equal(registration.options.attributes, true);
  assert.deepEqual(registration.options.attributeFilter, ["class"]);
  // 尚未 disconnect。
  assert.equal(harness.disconnectCallCount(), 0);
  handle.disconnect();
});

test("host class switch re-resolves and re-applies through the composition callback", () => {
  const harness = createObservationHarness([], true);
  observeArenaTheme(harness.deps);
  assert.equal(harness.target.lastTheme(), "dark");
  // 宿主切到 Zai 浅色变体 → 回调重解析为 light。
  harness.target.setClasses(["theme-zai-light"]);
  harness.deliver();
  assert.equal(harness.target.themeCalls().length, 2);
  assert.equal(harness.target.lastTheme(), "light");
  // 宿主再切到通用深色 → dark 优先级在线上依然成立。
  harness.target.setClasses(["dark", "theme-zai-light"]);
  harness.deliver();
  assert.equal(harness.target.themeCalls().length, 3);
  assert.equal(harness.target.lastTheme(), "dark");
});

test("system-preference fallback re-resolves on later callbacks (no host classes)", () => {
  const harness = createObservationHarness([], false);
  observeArenaTheme(harness.deps);
  assert.equal(harness.target.lastTheme(), "light");
  harness.setSystemDark(true);
  harness.deliver();
  assert.equal(harness.target.themeCalls().length, 2);
  assert.equal(harness.target.lastTheme(), "dark");
});

test("disconnect forwards to the registered observer and stops re-application", () => {
  const harness = createObservationHarness(["theme-zai-light"], false);
  const handle = observeArenaTheme(harness.deps);
  assert.equal(harness.target.lastTheme(), "light");
  handle.disconnect();
  assert.equal(harness.disconnectCallCount(), 1, "the registered observer's disconnect must be called");
  // disconnect 之后：即使宿主 class 再翻转、回调不再送达 → 不再重落属性。
  harness.target.setClasses([]);
  harness.setSystemDark(true);
  harness.deliver();
  assert.equal(harness.target.themeCalls().length, 1, "no re-apply after disconnect");
  assert.equal(harness.target.lastTheme(), "light");
});
