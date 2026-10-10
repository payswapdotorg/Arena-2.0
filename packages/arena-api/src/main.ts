import { createSqliteRuntime, type SqliteRuntime } from "@arena/persistence";
import { createArenaServer } from "./contract.js";

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
 */

const port = Number(process.env.ARENA_API_PORT ?? 3901);
const dbPath = process.env.ARENA_DB_PATH ?? "arena-reference.db";
const runtime: SqliteRuntime = createSqliteRuntime({ path: dbPath });
const server = createArenaServer({
  runtime,
  persistence: {
    mode: "sqlite_reference_engine",
    ready: true,
    disclosure:
      "node:sqlite reference engine per ADR-0001 (single instance; production multi-instance engine remains open with its own ADR + evidence)",
  },
});
server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `arena-api listening on http://127.0.0.1:${port} (DEMO auth, DURABLE sqlite runtime @ ${dbPath})\n`,
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
