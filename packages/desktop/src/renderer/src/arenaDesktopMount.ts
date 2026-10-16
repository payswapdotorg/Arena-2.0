/**
 * UIA-002 —— 桌面 Arena-first 挂载决策 + 组合根（issue #71）。
 *
 * 纯模块（node 可测）：入口模式谓词、baseUrl 法则、五屏组合构造。
 * 与 packages/web/src/main.tsx 的 renderArenaShell() 结构逐一对应
 * （UIA-001 集成先例）；谓词与组合按「每个 entry 复制一份」披露
 * （共享模块会跨 web/desktop 写 fence —— 与 shim 同一披露姿态）。
 *
 * 诚实姿态（spec/ux/arena-native-ui.md §2.3）：未配置 baseUrl 时不落入
 * mock 成功、不假成功 —— 绑定指向不可达哨兵（端口 0 永远无法建立连接），
 * 屏面的类型化连接失败状态逐字渲染。桌面当前没有随包的 arena-api
 * （部署拓扑是运营方记录在案的前沿）。
 */
import { ARENA_DEFAULT_SCREEN } from "@arena/shell";
import { applyDocumentTitle } from "@arena/shell/identity";
import { shellFromRegistrations } from "@arena/shell/shell";
import {
  bindingAuditAdapter,
  bindingCommandAdapter,
  bindingReviewerAdapters,
  developerRegistration,
  expertRegistration,
  mockAttemptsAdapter,
  mockDecksAdapter,
  operationsRegistration,
  remoteStationProbes,
  requesterRegistration,
  reviewerRegistration,
} from "@arena/shell/screens";
import { DEMO_EXPERT_PRINCIPAL, MockArenaClient, RealWorkbenchBinding } from "@arena/workbench";

/** 桌面入口模式：Arena 外壳优先；继承工作台经显式回退入口（集成落地期）。 */
export type DesktopEntryMode = "arena-first" | "workspace-fallback";

/**
 * 入口谓词（与 web 的 isLegacyWorkspaceEntry 同一语义，按 entry 复制一份）：
 * `workspace=1` 或 `app=workspace` → workspace-fallback，其余 → arena-first。
 */
export function parseDesktopEntryMode(search: string): DesktopEntryMode {
  const params = new URLSearchParams(search);
  return params.get("workspace") === "1" || params.get("app") === "workspace"
    ? "workspace-fallback"
    : "arena-first";
}

/**
 * baseUrl 法则（与 web 同名环境变量 VITE_ARENA_API_URL）：去首尾空白、
 * 去尾部 `/`；空/全空白（或剥完为空）→ undefined = 诚实未配置姿态。
 */
export function resolveArenaDesktopBaseUrl(envValue: string | undefined): string | undefined {
  const trimmed = typeof envValue === "string" ? envValue.trim() : "";
  if (trimmed === "") return undefined;
  const stripped = trimmed.replace(/\/+$/u, "");
  return stripped === "" ? undefined : stripped;
}

/**
 * DIST-001（issue #84）station baseUrl 法则：烘焙 env（VITE_ARENA_API_URL，运营方拓扑）
 * 优先于窗口 query 注入（主进程随包本地 test-mode station 的 `arenaApiUrl` 参数）。
 * 两层判定同向：烘焙 env 有值时主进程本就不启动 station（ARENA_DESKTOP_BAKED_API_URL
 * 探针）—— 这里是渲染侧同一优先级的收口。query 值同样过 trim 法则；两者皆空 →
 * undefined = 未配置哨兵姿态（UIA-002 法则不变）。
 */
export function resolveArenaStationBaseUrl(
  envValue: string | undefined,
  queryValue: string | undefined,
): string | undefined {
  const fromEnv = resolveArenaDesktopBaseUrl(envValue);
  if (fromEnv !== undefined) return fromEnv;
  return resolveArenaDesktopBaseUrl(queryValue);
}

/**
 * 诚实未配置哨兵：RealWorkbenchBinding 的公共契约要求 baseUrl: string，
 * 未配置时传端口 0（`http://127.0.0.1:0`）—— 一个无法意外命中任何服务
 * 的地址：任何连接尝试立即失败 → 类型化 TRANSPORT_ERROR 逐字上屏。
 * 绝不退化成 mock 成功（无假成功法）。
 */
const UNCONFIGURED_ARENA_BASE_URL = "http://127.0.0.1:0";

/** 组合根产物：五屏注册表 + 文档标题应用（identity law 收口在此模块）。 */
export interface ArenaDesktopComposition {
  registry: ReturnType<typeof shellFromRegistrations>;
  /** 应用 Arena 默认屏标题；返回恢复函数（applyDocumentTitle 语义）。 */
  applyTitle(): () => void;
}

/**
 * 五屏组合（镜像 web 组合根）：requester/operations 用披露的 demo 注册表
 * 主体；expert/reviewer 用 DEMO_EXPERT_PRINCIPAL（attempt/deck 种子租户）；
 * attempt/deck 投影今日是 demo 标注的 MockArenaClient（屏上如实披露）；
 * 命令/时间线/审计走真实绑定（baseUrl 由调用方按环境解析传入）。
 */
export function buildArenaDesktopComposition(options: {
  baseUrl: string | undefined;
}): ArenaDesktopComposition {
  const binding = new RealWorkbenchBinding({
    baseUrl: options.baseUrl ?? UNCONFIGURED_ARENA_BASE_URL,
  });
  // UIA-004：探针与绑定指向同一 ARENA RUNTIME 站点（配置的 baseUrl；
  // 未配置时同为诚实哨兵 —— fetch 立即失败 → 类型化 DOWN fail-closed，
  // 绝不退回伪造 ready，也绝不静默 unwired 冒充已测）。
  const stationProbes = remoteStationProbes(
    options.baseUrl ?? UNCONFIGURED_ARENA_BASE_URL,
  );
  const requesterPrincipal = { tenant_id: "tnt_00000001", user_id: "usr_00000001" };
  // attempt/deck 投影（demo 标注）用专家种子租户；真实绑定命令通道按
  // principal 解析凭据（DEMO 注册表镜像）。
  const expertPrincipal = DEMO_EXPERT_PRINCIPAL;
  const demoWorkbenchClient = new MockArenaClient();

  const registry = shellFromRegistrations([
    requesterRegistration({ binding, principal: requesterPrincipal }),
    expertRegistration({
      attempts: mockAttemptsAdapter(demoWorkbenchClient),
      commands: bindingCommandAdapter(binding, expertPrincipal),
      principal: expertPrincipal,
    }),
    reviewerRegistration({
      decks: mockDecksAdapter(demoWorkbenchClient),
      ...bindingReviewerAdapters(binding, expertPrincipal),
      principal: expertPrincipal,
    }),
    developerRegistration(),
    operationsRegistration({
      audit: bindingAuditAdapter(binding),
      principal: requesterPrincipal,
      probes: stationProbes,
    }),
  ]);

  return {
    registry,
    applyTitle: () => applyDocumentTitle(ARENA_DEFAULT_SCREEN),
  };
}
