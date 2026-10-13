import { createSqliteRuntime, type SqliteRuntime } from "@arena/persistence";
import {
  IdentityConfigError,
  createOidcIdentityAdapter,
  loadIdentityConfigFromEnv,
  type OidcAdapterEnvConfig,
} from "@arena/identity";
import {
  createArenaServer,
  createAuthGateway,
  createDemoAuthGateway,
  type AuthGateway,
} from "./contract.js";

/**
 * 本地监听入口（AR2-005 slice 2 起 DURABLE 组装根）：
 *   node --experimental-strip-types packages/arena-api/src/main.ts
 * 或 tsx。默认端口 3901（ARENA_API_PORT 可覆盖）。
 *
 * 运行时 = @arena/persistence node:sqlite 参考引擎（ADR-0001）：
 * - 数据库文件由 ARENA_DB_PATH 指定（默认 arena-reference.db）；
 * - 构造时收敛 schema（migrations.applyMigrations，可从空库重放）；
 * - WAL + synchronous FULL + busy_timeout：多进程共享同一数据库文件
 *   即为「多 API 进程」拓扑（issue #7 验收场景 3 的测试基础）；
 * - SIGINT/SIGTERM 优雅关闭引擎。
 *
 * 身份（AR2-022，IDN1.0 seam）：默认 demo 注册表（DEMO-ONLY）；
 * ARENA_AUTH_MODE=oidc 组合生产参考实现（RS256+JWKS，issuer/audience/
 * clock-skew 界，密钥端点仅经环境变量）。配置错误 fail-fast 退出，
 * JWKS 启动探测失败只降级 readyz（验证路径仍 fail-closed）。
 */

const port = Number(process.env.ARENA_API_PORT ?? 3901);
const dbPath = process.env.ARENA_DB_PATH ?? "arena-reference.db";
const runtime: SqliteRuntime = createSqliteRuntime({ path: dbPath });

let identityConfig: ReturnType<typeof loadIdentityConfigFromEnv>;
try {
  identityConfig = loadIdentityConfigFromEnv(process.env);
} catch (error) {
  if (error instanceof IdentityConfigError) {
    process.stderr.write(`arena-api identity config error: ${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

let auth: AuthGateway;
if (identityConfig.mode === "oidc") {
  const oidcConfig: OidcAdapterEnvConfig = identityConfig;
  const adapter = createOidcIdentityAdapter({
    issuer: oidcConfig.issuer,
    audience: oidcConfig.audience,
    jwksUri: oidcConfig.jwksUri,
    clockSkewSeconds: oidcConfig.clockSkewSeconds,
    jwksCacheTtlMs: oidcConfig.jwksCacheTtlSeconds * 1000,
    jwksTimeoutMs: oidcConfig.jwksTimeoutMs,
    replayPolicy: oidcConfig.replayPolicy,
  });
  // 启动探测：只影响 readyz 投影；验证路径永不因此放行。
  void adapter.probe().then((readiness) => {
    if (!readiness.ready) {
      process.stderr.write(
        `arena-api identity adapter probe degraded: ${readiness.detail ?? "unknown"}\n`,
      );
    }
  });
  auth = createAuthGateway(adapter);
} else {
  auth = createDemoAuthGateway();
}

const server = createArenaServer({
  runtime,
  auth,
  persistence: {
    mode: "sqlite_reference_engine",
    ready: true,
    disclosure:
      "node:sqlite reference engine per ADR-0001 (single instance; production multi-instance engine remains open with its own ADR + evidence)",
  },
});
server.listen(port, "127.0.0.1", () => {
  const authMode = identityConfig.mode === "oidc" ? "OIDC (IDN1.0 reference)" : "DEMO auth";
  process.stdout.write(
    `arena-api listening on http://127.0.0.1:${port} (${authMode}, DURABLE sqlite runtime @ ${dbPath})\n`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.closeAllConnections?.();
    server.close(() => {
      runtime.close();
      process.exit(0);
    });
  });
}
