import { McpFacade } from "./mcp-facade.js";

/**
 * AR2-011 — MCP 门面的 stdio 进程入口。
 *
 * 环境变量：
 *   ARENA_SDK_BASE_URL  — 真实 Arena API URL（必需；无默认 —— fail-closed）；
 *   ARENA_SDK_BEARER    — Bearer token（必需 —— 与 API 边缘同一认证面）。
 *
 * 启动（外部进程调用真实 URL 的验收形态）：
 *   tsx packages/arena-sdk/src/mcp-main.ts
 * 协议：MCP JSON-RPC 2.0，逐行帧。
 */

const baseUrl = process.env.ARENA_SDK_BASE_URL;
const bearer = process.env.ARENA_SDK_BEARER;
if (baseUrl === undefined || baseUrl.length === 0) {
  process.stderr.write("ARENA_SDK_BASE_URL is required (fail-closed — no default URL)\n");
  process.exit(2);
}
if (bearer === undefined || bearer.length === 0) {
  process.stderr.write("ARENA_SDK_BEARER is required (identical authorization as the API edge)\n");
  process.exit(2);
}

const facade = new McpFacade({ baseUrl, credentials: { bearerToken: bearer } });
void facade.startStdio(process.stdin, process.stdout);
