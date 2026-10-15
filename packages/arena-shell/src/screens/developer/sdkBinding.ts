/**
 * UIA-003 — 开发者门户：真实 @arena/sdk 绑定适配器（node 侧组合根专用）。
 *
 * 冻结纪律：
 * - 只消费 @arena/sdk / @arena/workbench 的 **公开契约导出**（contract.ts 桶）：
 *   ArenaSdkClient / sdkQuickstart / canonicalRequestDigest / McpFacade /
 *   MCP_SERVER_NAME / MCP_SERVER_VERSION / MCP_DEFAULT_PROTOCOL_VERSION /
 *   SDK_DISCLOSURE / SDK_TEST_MODE_DISCLOSURE / MCP_FACADE_DISCLOSURE /
 *   DEMO_PRINCIPAL_TOKENS（demo 凭据注册表镜像 —— 与 RealWorkbenchBinding
 *   同法：生产认证适配器替换 token 来源，契约不变）。
 * - 本模块 **不得** 被 registration / presenters / 屏本体静态引入：
 *   @arena/sdk 公开桶转出 webhook-receiver（node:http 值导入），浏览器
 *   组合根（web / a11y render host）无该传输 shim —— 静态引入会破坏其
 *   esbuild/vite 打包。node 侧组合根（tsx 测试 / 未来 node 宿主）直接
 *   import 本模块构造 DeveloperSdkBinding。
 * - McpFacade 仅用于 toolDescriptors() 只读枚举 —— 零工具调用（门面的
 *   传输/凭据在描述符枚举路径上从不使用）。
 */
import {
  ArenaSdkClient,
  canonicalRequestDigest,
  McpFacade,
  MCP_DEFAULT_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  sdkQuickstart,
  MCP_FACADE_DISCLOSURE,
  SDK_DISCLOSURE,
  SDK_TEST_MODE_DISCLOSURE,
  type SdkCredentials,
} from "@arena/sdk";
import { DEMO_PRINCIPAL_TOKENS, type PrincipalCredentials } from "@arena/workbench";
import type { EscalationRequest } from "@arena/contracts";
import type { DeveloperPrincipal, DeveloperSdkBinding } from "./sdkMount.js";

export interface RealSdkBindingOptions {
  /** 真实 Arena API 边缘（组合根接线 —— 部署拓扑是运营方基础设施决策）。 */
  baseUrl: string;
  /** principal 凭据注册表（默认 = 披露的 demo 镜像）。 */
  principals?: readonly PrincipalCredentials[];
}

function credentialsKey(principal: DeveloperPrincipal): string {
  return `${principal.tenant_id}/${principal.user_id}`;
}

/** 真实 SDK 绑定：结构化端口的 @arena/sdk 公开导出实现。 */
export function realSdkBinding(options: RealSdkBindingOptions): DeveloperSdkBinding {
  const registry = options.principals ?? DEMO_PRINCIPAL_TOKENS;
  const credentials = new Map(
    registry.map((entry) => [credentialsKey(entry.principal), entry.bearerToken] as const),
  );
  // MCP 门面实例只用于工具描述符枚举（静态词表；传输/凭据从不触发）。
  const facadeForDescriptors = new McpFacade({
    baseUrl: options.baseUrl,
    credentials: { bearerToken: "" },
  });
  return {
    baseUrl: options.baseUrl,
    credentialsFor(principal) {
      const bearerToken = credentials.get(credentialsKey(principal));
      return bearerToken === undefined ? null : { bearerToken };
    },
    quickstart(request: EscalationRequest, auth: SdkCredentials) {
      return sdkQuickstart({ baseUrl: options.baseUrl }, request, auth);
    },
    timeline(escalation_id: string, auth: SdkCredentials) {
      return new ArenaSdkClient({ baseUrl: options.baseUrl }).getTimeline(escalation_id, auth);
    },
    toolDescriptors() {
      return facadeForDescriptors.toolDescriptors();
    },
    digest(request: EscalationRequest) {
      return canonicalRequestDigest(request);
    },
    mcpServer: {
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
      protocolVersion: MCP_DEFAULT_PROTOCOL_VERSION,
    },
    disclosures: {
      sdk: SDK_DISCLOSURE,
      testMode: SDK_TEST_MODE_DISCLOSURE,
      mcpFacade: MCP_FACADE_DISCLOSURE,
    },
  };
}
