import type { TenantContext } from "@arena/contracts";
import type {
  ActorRef,
  ScraperDefinition,
} from "../src/contract.js";
import type { DnsResolver } from "../src/contract.js";

/**
 * AR2-017 测试共享 fixtures —— 全确定性：无真实时钟（可注入）、无随机、
 * 无外部网络（fixture server 显式批准）。镜像 arena-acquisition 的测试纪律。
 */

export const NOW = "2026-10-12T00:00:00Z";
export const NOW_MS = Date.parse(NOW);
export const TENANT_ALPHA = "tnt_00000001";
export const TENANT_BETA = "tnt_00000002";
export const PUBLIC_IPV4 = "93.184.216.34";
export const PUBLIC_IPV4_ALT = "93.184.216.35";

export const ACTOR_AUTHOR: ActorRef = { actor_id: "act_00000001", role: "AUTHOR" };
export const ACTOR_REVIEWER: ActorRef = { actor_id: "act_00000002", role: "REVIEWER" };
export const ACTOR_RELEASER: ActorRef = { actor_id: "act_00000003", role: "RELEASER" };
export const ACTOR_OPERATOR: ActorRef = { actor_id: "act_00000004", role: "OPERATOR" };

/** 租户上下文（服务端从认证凭据推导的形状）。 */
export function tenantContext(tenantId: string): TenantContext {
  return {
    tenant_id: tenantId,
    derived_from: "authenticated_credentials",
    client_application_id: "app_00000001",
    principal_id: "prn_00000001",
    acting_identity_id: null,
    role: "requester",
    authorization_scope_ids: [],
  };
}

/** 可编程 DNS resolver（DNS-rebinding 形状用 mock 注入）。 */
export class MockResolver implements DnsResolver {
  private readonly map = new Map<string, Array<{ address: string; family: number }>>();
  public lookups: string[] = [];

  constructor(defaultAddress = PUBLIC_IPV4) {
    this.defaultAddress = defaultAddress;
  }

  private defaultAddress: string;

  bind(host: string, addresses: string[]): this {
    this.map.set(
      host,
      addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
    );
    return this;
  }

  setDefault(address: string): this {
    this.defaultAddress = address;
    return this;
  }

  async lookup(host: string): Promise<Array<{ address: string; family: number }>> {
    if (this.map.has(host)) this.lookups.push(host);
    const mapped = this.map.get(host);
    if (mapped !== undefined) return mapped;
    if (host === "unresolvable.example.org") throw new Error("NXDOMAIN");
    return [{ address: this.defaultAddress, family: this.defaultAddress.includes(":") ? 6 : 4 }];
  }
}

/** 生产形状的合法定义（域名为公网文档站）。 */
export function productionDefinition(overrides: Record<string, unknown> = {}): ScraperDefinition {
  return {
    schema_version: "SCRP1.0",
    definition_id: "sdf_00000001",
    tenant_id: TENANT_ALPHA,
    name: "Blender procedural-material references",
    description: "Collect current procedural material documentation references.",
    source_scope: {
      schemes: ["https", "http"],
      domains: ["docs.example.org", "*.example.org"],
      ports: [443, 80],
    },
    acquisition_method: "HTTP_CRAWL",
    inputs: [
      {
        name: "topic",
        required: true,
        schema_ref: { schema_id: "sch_00000003", schema_version: "1.0.0" },
      },
    ],
    seeds: ["https://docs.example.org/materials/guide"],
    output_schema: { schema_id: "sch_00000001", schema_version: "1.2.0" },
    build_source: {
      origin: "LLM_GENERATED",
      generator_ref: "arena-scraper-forge@1",
      source_digest: "ab".repeat(32),
    },
    runtime_requirements: {
      engine: "crawlee-basic-http",
      runtime: "node24",
      crawlee_version: "3.18.2",
      max_concurrency: 1,
    },
    dependency_lock: [
      { name: "crawlee", version: "3.18.2", license: "Apache-2.0", integrity: "sha512-deadbeef" },
      { name: "cheerio", version: "1.2.0", license: "MIT", integrity: "sha512-cafebabe" },
    ],
    resource_policy: {
      max_pages: 50,
      max_items: 200,
      max_bytes: 5_000_000,
      max_depth: 2,
      wall_time_seconds: 120,
    },
    safety_profile: {
      authentication_bypass: false,
      captcha_bypass: false,
      paywall_bypass: false,
      access_control_bypass: false,
      stealth_fingerprint_evasion: false,
      proxy_rotation_evasion: false,
      source_requires_authentication: false,
      private_data_sources: false,
      notes: null,
    },
    rights_profile: {
      source_rights_posture: "PERMITTED",
      license_assessment: "CC-BY-SA documentation, tenant-scoped retrieval use",
      rights_evidence: ["https://docs.example.org/license"],
    },
    robots_policy: {
      respect_robots: true,
      user_agent: "arena-scraper/1.0",
      crawl_delay_ms: 0,
      per_domain_request_limit: 1000,
    },
    retention_class: "STANDARD",
    ...overrides,
  } as ScraperDefinition;
}

/** 面向本地 fixture server 的定义（显式批准 127.0.0.1 测试端点）。 */
export function fixtureDefinition(
  fixturePort: number,
  seeds: string[],
  overrides: Record<string, unknown> = {},
): ScraperDefinition {
  return productionDefinition({
    definition_id: "sdf_00000002",
    source_scope: {
      schemes: ["http"],
      domains: ["127.0.0.1"],
      ports: [fixturePort],
    },
    seeds,
    resource_policy: {
      max_pages: 10,
      max_items: 100,
      max_bytes: 1_000_000,
      max_depth: 1,
      wall_time_seconds: 30,
    },
    robots_policy: {
      respect_robots: true,
      user_agent: "arena-scraper-test/1.0",
      crawl_delay_ms: 0,
      per_domain_request_limit: 1000,
    },
    ...overrides,
  });
}

/** 已批准的 fixture 端点（egress 测试例外，显式可审计）。 */
export function fixtureEndpoint(fixturePort: number, justification = "local test fixture server (test-only)") {
  return { host: "127.0.0.1", port: fixturePort, justification };
}

/** 真实 sleep/时钟组合（引擎/连接器时序测试用）。 */
export const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
export const realNowMs = (): number => Date.now();
export const realNowIso = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/** 手动时钟（run-service 确定性测试用）。 */
export class ManualClock {
  private currentMs: number;

  constructor(startMs = NOW_MS) {
    this.currentMs = startMs;
  }

  nowMs = (): number => this.currentMs;

  nowIso = (): string => new Date(this.currentMs).toISOString().replace(/\.\d{3}Z$/, "Z");

  advance(ms: number): void {
    this.currentMs += ms;
  }
}

/** 恒定 secret resolver（只返回与 ref 对应的测试值，绝不外泄到记录）。 */
export const APIFY_TOKEN_SECRET_REF = "sec_apify_token_0001";
export const APIFY_TOKEN_VALUE = "apify-token-TEST-DO-NOT-LEAK-0001";

export function secretResolverFor(refs: Record<string, string>) {
  return {
    async resolve(secretRef: string): Promise<string> {
      const value = refs[secretRef];
      if (value === undefined) throw new Error(`unknown secret ref ${secretRef}`);
      return value;
    },
  };
}
