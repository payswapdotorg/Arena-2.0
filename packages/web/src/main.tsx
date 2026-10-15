/* eslint-disable max-lines -- Web 入口集中编排启动、路由与 workspace shell wiring，与 Root.tsx 同样先保持入口收口，避免跨层状态拆散。 */
import { createRoot } from "react-dom/client";
import {
  AppErrorBoundary,
  Root,
  ZCodeIntlProvider,
  generateMobileDeviceFingerprint,
  playTaskNotificationSound,
  setStreamClientId,
  type Theme,
} from "@zcode/ui";
import "@zcode/ui/styles.css";
import { connectViaWebSocket } from "@zcode/client";
import {
  ArenaShell,
  shellFromRegistrations,
} from "@arena/shell/shell";
import { ARENA_DEFAULT_SCREEN } from "@arena/shell";
import { applyDocumentTitle } from "@arena/shell/identity";
import { applyArenaTheme, observeArenaTheme, resolveArenaTheme } from "@arena/shell/theme";
import "@arena/shell/styles.css";
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
import { WebCallbackPage } from "./auth/WebCallbackPage.js";
import { createWebAuthService } from "./auth/webAuthService.js";
import { WEB_ZAI_OAUTH_CONFIG, resolveWebAuthDevReturnTo } from "./auth/webZaiOAuthConfig.js";
import { parseOAuthState, resolveSafeAppReturnTo } from "./auth/oauthStateCodec.js";
import { resolveWebCommunityUrl, resolveWebHelpConfig } from "./communityUrl.js";
import {
  ConversationShareLandingLoader,
  ConversationShareLandingStatus,
} from "./share/ConversationShareLandingPage.js";
import {
  ConversationSharePreviewClient,
  resolveConversationShareRouteLocale,
} from "./share/conversationSharePreviewClient.js";
import {
  isConversationSharePath,
  resolveConversationShareCodeFromPath,
} from "./share/conversationShareRoute.js";
import type { IPlatformService, RemoteTarget, ServerRemoteInfo } from "@zcode/shared";
import { WEB_DEFAULT_THEME, resolveWebInitialTheme } from "./webThemeSeed.js";

function resolveWebThemePreference(defaultTheme: Theme = WEB_DEFAULT_THEME): Theme {
  const saved = localStorage.getItem("zcode-theme");
  return resolveWebInitialTheme({ storedTheme: saved, defaultTheme });
}

// 初始化主题：默认 Zai dark，后续由 useTheme hook 接管
// system 模式下需要查询系统偏好；非 system 模式直接用存储值
{
  // 分享页没有本地主题配置时使用浅色，已有配置仍然沿用；其他 Web 页面继续默认深色。
  const saved = resolveWebThemePreference(
    isConversationSharePath(window.location.pathname) ? "zai-light" : undefined,
  );
  const resolved =
    saved === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : saved === "dark" || saved === "zai-dark"
        ? "dark"
        : "light";
  const appliedTheme =
    saved === "system"
      ? resolved === "dark"
        ? "zai-dark"
        : "zai-light"
      : saved === "dark"
        ? "zai-dark"
        : saved === "light"
          ? "zai-light"
          : saved;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.classList.toggle("theme-zai-light", appliedTheme === "zai-light");
  document.documentElement.classList.toggle("theme-zai-dark", appliedTheme === "zai-dark");
}

async function resolveFeedbackUrl(): Promise<string | undefined> {
  return (await resolveWebHelpConfig()).feedback_url;
}

const root = createRoot(document.getElementById("root")!);
const webAuthService = createWebAuthService();

// 初始化 Web 端流式 clientId，确保所有 hook 在首次渲染前就使用稳定 ID
{
  setStreamClientId(generateMobileDeviceFingerprint());
}

interface WebBootstrapResult {
  wsUrl: string;
  initialWorkspaceAbsPath?: string;
  initialWorkspaceIdentity?: string;
  initialTaskId?: string;
  restoreSession?: boolean;
  allowOpenWorkspace?: boolean;
}

function isWebOAuthCallback(params: URLSearchParams): boolean {
  return (
    ["/cn/share/callback", "/share/callback"].includes(window.location.pathname) &&
    params.has("state") &&
    (params.has("code") || params.has("error"))
  );
}

/**
 * UIA-001 TL 集成（spec/ux/arena-native-ui.md §1.1/§1.2）：Arena 外壳是
 * 产品默认面（/ → requester 起步，#/<screenId> 深链）；继承的 ZCode 工作台
 * 不是屏词汇成员 —— 经显式回退入口（?workspace=1）保留「集成落地期」的
 * 可达性（spec：明确回退入口 + 仅在专家任务上下文内挂接的终局形态）。
 */
function isLegacyWorkspaceEntry(params: URLSearchParams): boolean {
  return params.get("workspace") === "1" || params.get("app") === "workspace";
}

/**
 * Arena 组合根（UIA-001）：真实绑定的 baseUrl 可配置（部署拓扑是运营方
 * 基础设施决策）；principal 用披露的 demo 注册表（生产认证适配器属
 * 所有者决策前沿）；attempt/deck 投影今日是 demo 标注（屏上如实披露）。
 */
function renderArenaShell(): void {
  const baseUrl =
    import.meta.env.VITE_ARENA_API_URL?.trim().replace(/\/+$/u, "") || window.location.origin;
  const binding = new RealWorkbenchBinding({ baseUrl });
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
      // UIA-004 TL 集成：注入远端站点探针（浏览器安全、check 时实测）——
      // 探针测度的是 ARENA RUNTIME 站点（绑定 baseUrl 目标；部署拓扑是
      // 记录在案的运营方前沿）。端点不可达 → 类型化 DOWN fail-closed，
      // 绝不退回伪造 ready。
      probes: remoteStationProbes(baseUrl),
    }),
  ]);

  applyDocumentTitle(ARENA_DEFAULT_SCREEN);
  // UIA-005 TL 集成：Arena 明暗主题激活 —— 从宿主主题 class（bootstrap 块
  // 维护的 dark/theme-zai-light/theme-zai-dark）解析 + 落 data-arena-theme
  // （激活 arena-tokens.css 浅色回退组）；MutationObserver 监听宿主 class
  // 变更实时重解析（运行时切主题同步重校准）。模块零 DOM 全局 —— 组合根
  // 按其 docblock 接线配方注入（resolve/apply/observe 均其导出）。
  {
    const rootEl = document.documentElement;
    const systemDark = () =>
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const reapply = () =>
      applyArenaTheme(
        rootEl,
        resolveArenaTheme({ classList: rootEl.classList, systemDark: systemDark() }),
      );
    const observer = new MutationObserver(reapply);
    observeArenaTheme({
      target: rootEl,
      systemDark,
      observe: (target, options) => {
        observer.observe(target as Element, options as MutationObserverInit);
        return observer;
      },
    });
  }
  root.render(
    <AppErrorBoundary>
      <ArenaShell registry={registry} announceKeyboardHints />
    </AppErrorBoundary>,
  );
}

function renderWebAuthCallbackPage(): void {
  document.title = "Arena — Sign In";
  const callbackState = parseOAuthState(
    new URLSearchParams(window.location.search).get("state") ?? "",
  );
  const safeRetryTarget = resolveSafeAppReturnTo(callbackState?.app_return_to);
  root.render(
    <WebCallbackPage
      authService={webAuthService}
      onSuccess={({ appReturnTo }) => {
        window.location.replace(appReturnTo ?? "/");
      }}
      onRetry={() => {
        window.location.replace(safeRetryTarget ?? "/");
      }}
    />,
  );
}

async function renderConversationSharePage(): Promise<void> {
  // 页面语言跟随路径前缀：/cn/share 中文，裸 /share 英文。
  const routeLocale = resolveConversationShareRouteLocale(window.location.pathname);
  // index.html 固定 lang="en"；不同步会让中文分享页对无障碍与浏览器翻译都报错语言。
  document.documentElement.lang = routeLocale;
  // 分享页必须设置 title：否则浏览器标签只显示 index.html 的通用标题。
  // 会话标题要等 preview 加载完，先给一个语言正确的兜底。
  document.title = routeLocale === "zh-CN" ? "Arena 会话分享" : "Arena Conversation Share";
  const shareCode = resolveConversationShareCodeFromPath(window.location.pathname);
  if (!shareCode) {
    root.render(
      <ConversationShareLandingStatus
        state={{ kind: "error", error: "invalid_contract" }}
        locale={routeLocale}
      />,
    );
    return;
  }

  const endpointOrigin =
    import.meta.env.VITE_ZCODE_BASE_URL?.trim().replace(/\/+$/u, "") || window.location.origin;
  const mockMode =
    import.meta.env.DEV && import.meta.env.VITE_CONVERSATION_SHARE_PREVIEW_MOCK === "true";
  // Share 加载失败不能只有通用 network 文案：需要区分 mock、endpoint 配置或跨域 fetch。
  // 这里只记录运行时路由与 endpoint，不记录完整 pathname，避免把 share code 写入日志。
  console.info("[conversation-share-web]", "preview_runtime_initialized", {
    browserOrigin: window.location.origin,
    routeKind: "canonical",
    endpointOrigin,
    transport: mockMode ? "mock" : "fetch",
  });
  const client = mockMode
    ? new (
        await import("./share/mockConversationSharePreviewClient.js")
      ).MockConversationSharePreviewClient()
    : new ConversationSharePreviewClient({ baseUrl: `${endpointOrigin}/api/v1` });
  const getMockToken = () =>
    mockMode && window.sessionStorage.getItem("zcode:share:mock-auth") === "owner"
      ? "mock-owner-token"
      : null;
  const onLogout = () => {
    if (mockMode) {
      window.sessionStorage.removeItem("zcode:share:mock-auth");
      window.location.reload();
      return;
    }
    void webAuthService.logout();
  };
  root.render(
    <ConversationShareLandingLoader
      shareCode={shareCode}
      client={client}
      getAccessToken={() => getMockToken() ?? webAuthService.getZCodeJwtToken()}
      onLogin={(provider) => {
        if (mockMode) {
          window.sessionStorage.setItem("zcode:share:mock-auth", "owner");
          window.location.reload();
          return;
        }
        webAuthService.startLogin({
          provider,
          appReturnTo: window.location.href,
          redirectUri: WEB_ZAI_OAUTH_CONFIG.shareRedirectUri,
          devReturnTo: resolveWebAuthDevReturnTo(WEB_ZAI_OAUTH_CONFIG),
        });
      }}
      onLogout={onLogout}
      locale={routeLocale}
      theme={resolveWebThemePreference("zai-light")}
    />,
  );
}

function createWebPlatform(): IPlatformService {
  return {
    canSelectFilePath: false,
    // Web 端无法打开系统目录选择框
    selectDirectory: () => Promise.resolve(null),
    // Web 端无法打开系统文件选择框
    selectFile: () => Promise.resolve(null),
    selectFiles: () => Promise.resolve([]),
    getPathForFile: () => null,
    createTempTextAttachment: () =>
      Promise.reject(new Error("Temporary text attachments require a desktop host")),
    onRemoteConnectionLog: () => () => {},
    onRemoteSessionClosed: () => () => {},
    onBotRemoteWorkspaceReconnected: () => () => {},
    // Web 端无多窗口管理
    activateOrSetWorkspace: () => Promise.resolve({ activated: false }),
    // TODO(web-remote-workspace): 普通 Web 模式先只保证 server 本地工作区可用。
    // 远程 WebSocket 只暴露部分 service，与 Root/RemoteServiceAccess 需要的完整
    // accessor 不匹配，直接打开 ?remote=<id> 会在项目向导或首屏卡住。
    connectRemote(options: RemoteTarget) {
      return Promise.resolve({
        success: false,
        error: `Remote connect is not supported in Web mode yet: ${options.kind}`,
      });
    },
    cancelPendingRemoteConnection: (_requestId?: string) => Promise.resolve(),
    disposeRemoteSession: () => Promise.resolve(),
    isDockerAvailable: () => Promise.resolve(false),
    listWSLDistros: () => Promise.resolve([]),
    listDockerContainers: () => Promise.resolve([]),
    listSSHConfigAliases: () => Promise.resolve([]),
    loadMcpFromUserDirectory: () => Promise.resolve({ servers: [] }),
    saveMcpToUserDirectory: () =>
      Promise.resolve({
        success: false,
        error: "MCP native directory management requires a desktop attachment",
      }),
    migrateLegacyCommonMcp: () =>
      Promise.resolve({
        servers: {},
        totalCount: 0,
        importedCount: 0,
        skippedCount: 0,
      }),
    openExternal: (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    openFeedback: async () => {
      const feedbackUrl = await resolveFeedbackUrl();
      if (!feedbackUrl) {
        return;
      }
      window.open(feedbackUrl, "_blank", "noopener,noreferrer");
    },
    openCommunity: async () => {
      const locale = document.documentElement.lang === "en-US" ? "en-US" : "zh-CN";
      const communityUrl = await resolveWebCommunityUrl(locale);
      if (!communityUrl) {
        return;
      }
      window.open(communityUrl, "_blank", "noopener,noreferrer");
    },
    canOpenCommunity: async (locale) => {
      const communityUrl = await resolveWebCommunityUrl(locale);
      return typeof communityUrl === "string" && communityUrl.length > 0;
    },
    openInFileManager: () =>
      Promise.resolve({ success: false, error: "Not supported in web mode" }),
    openExternalFile: () => Promise.resolve({ success: false, error: "Not supported in web mode" }),
    registerOAuthState: (_payload) => {},
    onOAuthCallback: () => () => {},
    onPaymentCallback: () => () => {},
    onShareImport: () => () => {},
    notifyRendererReady: () => {},
    reportTelemetryEvent: async () => {},
    reportArmsCustomEvent: () => Promise.resolve(),
    showTaskNotification: (payload) => {
      if (document.hasFocus()) {
        return;
      }

      if (
        typeof window.Notification === "undefined" ||
        window.Notification.permission !== "granted"
      ) {
        return;
      }

      try {
        new window.Notification(payload.title, {
          body: payload.body,
          silent: true,
        });
        void playTaskNotificationSound();
      } catch {
        // 浏览器通知不可用时静默忽略，避免打断主流程
      }
    },
    // Web 端不需要跨窗口 tab 管理
    syncWindowTabs: () => {},
    // Web 端没有宿主层 Dock / 任务栏徽标，保持空实现以兼容统一平台接口
    syncWindowUnreadCount: () => {},
    syncActiveTaskSession: () => {},
    onFocusTab: () => () => {},
    onNewTab: () => () => {},
    onCloseActiveContextRequest: () => () => {},
    onOpenBrowserUrl: () => () => {},
    onNewTask: () => () => {},
    onOpenWorkspace: () => () => {},
    onWindowFullscreenChanged: () => () => {},
    onTaskNotificationClick: () => () => {},
    exportLogs: () => Promise.resolve({ success: false, error: "Not supported in web mode" }),
    captureWindowScreenshot: () => Promise.resolve(null),
    importChromeBrowserData: (_options) =>
      Promise.resolve({
        success: false,
        cookies: { imported: 0, skipped: 0, failed: 0 },
        localStorage: {
          originsImported: 0,
          entriesImported: 0,
          originsSkipped: 0,
          originsFailed: 0,
        },
        error: "chrome_import_not_supported" as const,
      }),
    clearEmbeddedBrowserData: () =>
      Promise.resolve({ success: false, error: "Not supported in web mode" }),
    // IPlatformService 新增更新提示能力后，Web fallback 没有同步补齐空实现，
    // 根级 typecheck 会直接失败，连与桌面端无关的改动都没法完成校验。
    // Web 端当前没有桌面更新器，先显式 no-op，保持接口完整且不改变现有行为。
    onUpdateReady: () => () => {},
    onUpdateCheckResult: () => () => {},
    onUpdateStateChanged: () => () => {},
    getUpdateState: () => Promise.resolve({ kind: "idle", enabled: true }),
    downloadUpdate: () => Promise.resolve(),
    cancelUpdateDownload: () => Promise.resolve(),
    getDesktopSessionActivity: () => Promise.resolve({ runningAgentSessionCount: 0 }),
    getDesktopZoomLevel: () => Promise.resolve({ zoomLevel: 0 }),
    onDesktopZoomLevelChanged: () => () => {},
    onPostUpdateReleaseNotes: () => () => {},
    acknowledgePostUpdateReleaseNotes: () => Promise.resolve(),
    skipUpdateVersion: () => Promise.resolve(),
    quitAndInstallUpdate: () => Promise.resolve(),
    getInstalledEditors: () => Promise.resolve([]),
    openInEditor: () => Promise.resolve({ success: false, error: "Not supported in web mode" }),
    executeDesktopCommand: () => Promise.resolve(),
    setApplicationLocale: (_locale) => Promise.resolve(),
    setTitleBarTheme: () => Promise.resolve(),
    getDeviceId: () => {
      const nav = globalThis.navigator as Navigator & { platform?: string };
      const platform = nav?.platform ?? "";
      const screenWidth = globalThis.screen?.width;
      const screenHeight = globalThis.screen?.height;
      const colorDepth = globalThis.screen?.colorDepth;
      const parts = [
        platform,
        screenWidth !== undefined ? String(screenWidth) : "",
        screenHeight !== undefined ? String(screenHeight) : "",
        colorDepth !== undefined ? String(colorDepth) : "",
      ];
      return parts.filter(Boolean).join("|");
    },
  };
}

function resolveDefaultWsOrigin(): string {
  return `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
}

async function resolveWebBootstrap(): Promise<WebBootstrapResult> {
  const params = new URLSearchParams(window.location.search);
  const remoteId = params.get("remote");
  const wsUrl = remoteId
    ? `${resolveDefaultWsOrigin()}/ws/remote/${remoteId}`
    : `${resolveDefaultWsOrigin()}/ws`;

  if (remoteId) {
    return { wsUrl };
  }

  try {
    const response = await fetch("/api/server-info", {
      cache: "no-store",
    });
    if (!response.ok) {
      return { wsUrl };
    }
    const serverInfo = (await response.json()) as Partial<ServerRemoteInfo>;
    const workspace = Array.isArray(serverInfo.workspaces) ? serverInfo.workspaces[0] : undefined;
    return {
      wsUrl,
      ...(workspace?.path ? { initialWorkspaceAbsPath: workspace.path } : {}),
      ...(workspace?.workspaceIdentity
        ? { initialWorkspaceIdentity: workspace.workspaceIdentity }
        : {}),
    };
  } catch {
    return { wsUrl };
  }
}

function WebBootstrapErrorScreen({ message }: { message: string }) {
  return (
    <div className="h-dvh min-h-dvh w-screen bg-background text-foreground">
      <div className="mx-auto flex h-full w-full max-w-lg items-center px-4">
        <section className="w-full rounded-xl border border-card-border bg-card p-5">
          <div className="flex items-center gap-3">
            <span className="size-2 rounded-full bg-destructive" />
            <h1 className="text-ui-xs font-medium">
              {/^zh\b/i.test(navigator.language) ? "Web 启动失败" : "Web bootstrap failed"}
            </h1>
          </div>
          <p className="mt-2 break-all text-ui-xs/relaxed text-foreground-subtle">{message}</p>
          <button
            type="button"
            className="mt-4 rounded-lg border border-border bg-surface px-3 py-2 text-ui-xs text-foreground-subtle hover:bg-surface-hover"
            onClick={() => {
              window.location.reload();
            }}
          >
            {/^zh\b/i.test(navigator.language) ? "重试" : "Retry"}
          </button>
        </section>
      </div>
    </div>
  );
}

function renderWebBootstrapError(error: unknown): void {
  document.title = "Arena — Web";
  root.render(
    <WebBootstrapErrorScreen message={error instanceof Error ? error.message : String(error)} />,
  );
}

async function bootstrapWebApp() {
  const params = new URLSearchParams(window.location.search);
  if (isWebOAuthCallback(params)) {
    renderWebAuthCallbackPage();
    return;
  }

  if (isConversationSharePath(window.location.pathname)) {
    await renderConversationSharePage();
    return;
  }

  // UIA-001：Arena 外壳 = 产品默认首屏（spec §1.2「/ → shell 默认」）；
  // 继承工作台经显式回退入口保留（集成落地期，非主导航/空态/首启身份）。
  if (!isLegacyWorkspaceEntry(params)) {
    renderArenaShell();
    return;
  }

  let bootstrap: WebBootstrapResult;
  try {
    bootstrap = await resolveWebBootstrap();
  } catch (error) {
    renderWebBootstrapError(error);
    return;
  }

  try {
    const services = await connectViaWebSocket(bootstrap.wsUrl, {
      onClose: () => {},
    });
    const platform = createWebPlatform();
    document.title = "Arena — solution workspace (inherited)";

    root.render(
      <AppErrorBoundary>
        <ZCodeIntlProvider
          settingService={services.settingService}
          broadcastService={services.broadcastService}
        >
          <Root
            services={services}
            platform={platform}
            initialWorkspaceAbsPath={bootstrap.initialWorkspaceAbsPath}
            initialWorkspaceIdentity={bootstrap.initialWorkspaceIdentity}
            initialTaskId={bootstrap.initialTaskId}
            restoreSession={bootstrap.restoreSession}
            allowOpenWorkspace={bootstrap.allowOpenWorkspace}
            preferDirectoryBrowser
            supportsEmbeddedBrowser={false}
            allowRemoteWorkspace={false}
          />
        </ZCodeIntlProvider>
      </AppErrorBoundary>,
    );
  } catch (error) {
    renderWebBootstrapError(error);
  }
}

void bootstrapWebApp();
