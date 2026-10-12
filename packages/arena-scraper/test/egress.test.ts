import assert from "node:assert/strict";
import test from "node:test";
import {
  EgressGuard,
  domainMatchesAllowlist,
  prohibitedAddressLabel,
  prohibitedIpv4Label,
  prohibitedIpv6Label,
  type EgressPolicyConfig,
} from "../src/contract.js";
import { MockResolver, PUBLIC_IPV4 } from "./fixtures.js";
import { startFixtureServer } from "./fixture-server.js";
import {
  HttpValidatedFetcher,
  CrawlBudget,
  EgressDeniedError,
  type CrawlBudgetSpec,
} from "../src/contract.js";

/**
 * AR2-017 验收（issue #33）：egress guard —— SSRF/DNS-rebinding 防御。
 * 每个被禁类别（loopback/link-local/private/reserved/CGNAT/metadata/IPv6
 * 对应体/IPv4-mapped/NAT64）都被拒；八进制/十进制主机编码经 WHATWG
 * 规范化后被拒；同形字（homograph）不匹配 allowlist；解析歧义 fail-closed；
 * 重定向链逐跳复验（fixture server 集成）。
 */

const POLICY: EgressPolicyConfig = {
  schemes: ["http", "https"],
  domains: ["docs.example.org", "*.example.org"],
  ports: [80, 443],
  approved_endpoints: [],
  max_redirect_hops: 5,
};

function guard(resolver = new MockResolver(), policy = POLICY): EgressGuard {
  return new EgressGuard({ policy, resolver });
}

test("egress: every prohibited IPv4 class is labeled (loopback/private/link-local/CGNAT/metadata/reserved)", () => {
  const cases: Array<[string, string]> = [
    ["127.0.0.1", "loopback"],
    ["127.8.9.10", "loopback"],
    ["10.0.0.1", "private 10/8"],
    ["172.16.0.1", "private 172.16/12"],
    ["172.31.255.254", "private 172.16/12"],
    ["192.168.1.1", "private 192.168/16"],
    ["169.254.169.254", "link-local 169.254/16"],
    ["169.254.170.2", "link-local 169.254/16"],
    ["0.0.0.5", "reserved/zeroconf 0.0.0.0/8"],
    ["100.64.0.1", "shared/CGNAT 100.64/10"],
    ["224.0.0.1", "multicast"],
    ["240.0.0.1", "reserved 240/4"],
  ];
  for (const [ip, labelPart] of cases) {
    const label = prohibitedIpv4Label(ip);
    assert.ok(label !== null, `${ip} must be prohibited`);
    assert.ok(label.includes(labelPart), `${ip} -> ${label}`);
  }
  assert.equal(prohibitedIpv4Label("93.184.216.34"), null);
  assert.equal(prohibitedIpv4Label("8.8.8.8"), null);
});

test("egress: IPv6 equivalents are prohibited (loopback/link-local/ULA/multicast/mapped/NAT64)", () => {
  assert.ok(prohibitedIpv6Label("::1")?.includes("loopback"));
  assert.ok(prohibitedIpv6Label("::")?.includes("unspecified"));
  assert.ok(prohibitedIpv6Label("fe80::1")?.includes("link-local"));
  assert.ok(prohibitedIpv6Label("febf:ffff::1")?.includes("link-local"));
  assert.ok(prohibitedIpv6Label("fc00::1")?.includes("private"));
  assert.ok(prohibitedIpv6Label("fd12:3456::1")?.includes("private"));
  assert.ok(prohibitedIpv6Label("ff02::1")?.includes("multicast"));
  assert.ok(prohibitedIpv6Label("::ffff:127.0.0.1")?.includes("IPv4-mapped"));
  assert.ok(prohibitedIpv6Label("::ffff:10.0.0.1")?.includes("IPv4-mapped"));
  assert.ok(prohibitedIpv6Label("64:ff9b::127.0.0.1")?.includes("NAT64"));
  assert.equal(prohibitedIpv6Label("2606:2800:220:1:248:1893:25c8:1946"), null);
  assert.ok(prohibitedAddressLabel("::ffff:169.254.169.254") !== null);
});

test("egress: URL syntax enforces scheme, userinfo, domain and port allowlists", () => {
  const g = guard();
  assert.equal(g.validateUrlSyntax("https://docs.example.org/materials").ok, true);
  assert.equal(g.validateUrlSyntax("http://other.example.org/page").ok, true, "*.example.org wildcard");
  assert.equal(g.validateUrlSyntax("file:///etc/passwd").ok, false);
  assert.equal(g.validateUrlSyntax("ftp://docs.example.org/x").ok, false);
  assert.equal(g.validateUrlSyntax("http://user:pass@docs.example.org/").ok, false, "userinfo rejected");
  assert.equal(g.validateUrlSyntax("http://evil.com/").ok, false, "domain not allowlisted");
  assert.equal(g.validateUrlSyntax("http://docs.example.org.evil.com/").ok, false, "suffix confusion rejected");
  assert.equal(g.validateUrlSyntax("http://docs.example.org:8080/").ok, false, "port not allowlisted");
  assert.equal(g.validateUrlSyntax("http://docs.example.org:443/").ok, true, "explicit allowlisted port");
  assert.equal(g.validateUrlSyntax("not a url").ok, false);
});

test("egress: octal/decimal/hex host encodings normalize to prohibited literals and are rejected", () => {
  const g = guard();
  for (const weird of ["http://0177.0.0.1/", "http://2130706433/", "http://0x7f.1/", "http://127.1/"]) {
    const parsed = new URL(weird);
    assert.equal(parsed.hostname, "127.0.0.1", `${weird} normalizes`);
    const check = g.validateUrlSyntax(weird);
    assert.equal(check.ok, false, `${weird} must be rejected`);
    if (!check.ok) assert.ok(check.detail.includes("IP-literal destination 127.0.0.1"));
  }
});

test("egress: homograph hosts never match an exact-domain allowlist", () => {
  // Exact-domain allowlist (no wildcard): a Cyrillic 'о' inside docs.example.org
  // punycodes to xn--… and cannot match the ASCII allowlist entry.
  const exact = guard(
    new MockResolver(),
    { ...POLICY, domains: ["docs.example.org"] },
  );
  const homograph = "http://d\u043Ecs.example.org/";
  const parsed = new URL(homograph);
  assert.notEqual(parsed.hostname, "docs.example.org");
  assert.ok(parsed.hostname.startsWith("xn--"), `punycoded: ${parsed.hostname}`);
  const check = exact.validateUrlSyntax(homograph);
  assert.equal(check.ok, false);
  if (!check.ok) assert.ok(check.detail.includes("domain allowlist"));
  // A wildcard allowlist intentionally covers all ASCII/punycode subdomains of
  // the owner's zone — that is zone-owner scope, not a homograph bypass.
  assert.ok(domainMatchesAllowlist("anything.example.org", ["*.example.org"]));
});

test("egress: cloud metadata hostnames are rejected outright", () => {
  const g = guard();
  assert.equal(g.validateUrlSyntax("http://metadata.google.internal/computeMetadata/v1/").ok, false);
  assert.equal(g.validateUrlSyntax("http://169.254.170.2/latest/meta-data/").ok, false);
});

test("egress: an allowlisted domain with public DNS resolution passes full validation", async () => {
  const g = guard();
  const check = await g.validateUrl("https://docs.example.org/materials");
  assert.equal(check.ok, true);
});

test("egress: DNS rebinding shape — a public name resolving to a private IP is rejected", async () => {
  const resolver = new MockResolver().bind("docs.example.org", ["10.0.0.7"]);
  const g = guard(resolver);
  const check = await g.validateUrl("https://docs.example.org/materials");
  assert.equal(check.ok, false);
  if (!check.ok) assert.ok(check.detail.includes("10.0.0.7"));
  assert.ok(resolver.lookups.includes("docs.example.org"));
});

test("egress: a name resolving to the cloud metadata IP is rejected", async () => {
  const resolver = new MockResolver().bind("docs.example.org", ["169.254.169.254"]);
  const check = await guard(resolver).validateUrl("https://docs.example.org/");
  assert.equal(check.ok, false);
  if (!check.ok) assert.ok(check.detail.includes("169.254.169.254"));
});

test("egress: mixed public+private resolutions fail closed (ambiguity is denial)", async () => {
  const resolver = new MockResolver().bind("docs.example.org", ["93.184.216.34", "192.168.0.9"]);
  const check = await guard(resolver).validateUrl("https://docs.example.org/");
  assert.equal(check.ok, false);
});

test("egress: failed and empty resolutions fail closed", async () => {
  const failing = guard(new MockResolver().bind("docs.example.org", []));
  const empty = await failing.validateUrl("https://docs.example.org/");
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.ok(empty.detail.includes("empty DNS resolution"));
  const throwing = guard(new MockResolver());
  const nx = await throwing.validateUrl("https://unresolvable.example.org/");
  assert.equal(nx.ok, false);
  if (!nx.ok) assert.ok(nx.detail.includes("fail closed"), `detail: ${nx.detail}`);
});

test("egress: connection-time lookup re-validates (DNS-rebinding defense at the socket)", async () => {
  const rebound = new MockResolver().bind("docs.example.org", ["127.0.0.1"]);
  const guardRebound = guard(rebound);
  await new Promise<void>((resolve) => {
    guardRebound.connectionLookup("docs.example.org", { all: true }, (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("prohibited"));
      resolve();
    });
  });
  const healthy = guard(new MockResolver());
  await new Promise<void>((resolve) => {
    healthy.connectionLookup("docs.example.org", { all: true }, (err, addresses) => {
      assert.equal(err, null);
      assert.ok(Array.isArray(addresses));
      assert.equal((addresses as Array<{ address: string }>)[0]?.address, PUBLIC_IPV4);
      resolve();
    });
  });
  await new Promise<void>((resolve) => {
    healthy.connectionLookup("docs.example.org", { all: false }, (err, address) => {
      assert.equal(err, null);
      assert.equal(address, PUBLIC_IPV4);
      resolve();
    });
  });
});

test("egress: domain allowlist matching is exact or leftmost-wildcard", () => {
  const allowed = ["docs.example.org", "*.example.org"];
  assert.equal(domainMatchesAllowlist("docs.example.org", allowed), true);
  assert.equal(domainMatchesAllowlist("api.example.org", allowed), true);
  assert.equal(domainMatchesAllowlist("docs.example.org.evil.com", allowed), false);
  assert.equal(domainMatchesAllowlist("deep.nested.example.org", allowed), false, "wildcard is leftmost only");
  assert.equal(domainMatchesAllowlist("evil.com", allowed), false);
});

test("egress integration: an approved fixture endpoint is fetchable, an unapproved port on the same host is not", async () => {
  const server = await startFixtureServer({ pages: { "/allowed": "<html>ok</html>" } });
  try {
    const policy: EgressPolicyConfig = {
      schemes: ["http"],
      domains: ["docs.example.org"],
      ports: [server.port],
      approved_endpoints: [{ host: "127.0.0.1", port: server.port, justification: "local fixture" }],
      max_redirect_hops: 3,
    };
    const spec: CrawlBudgetSpec = {
      max_pages: 5,
      max_items: 10,
      max_bytes: 100000,
      max_depth: 1,
      wall_time_ms: 5000,
      max_retries_per_request: 1,
      retry_backoff_base_ms: 1,
      max_redirect_hops: 3,
    };
    const fetcher = new HttpValidatedFetcher({
      guard: guard(new MockResolver(), policy),
      budget: new CrawlBudget(spec, () => Date.now()),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
    const response = await fetcher.fetch(`http://127.0.0.1:${server.port}/allowed`, { timeout_ms: 3000, user_agent: "test" });
    assert.equal(response.status, 200);
    assert.ok(response.body_text.includes("ok"));

    const deniedPolicy: EgressPolicyConfig = {
      ...policy,
      ports: [80, 443],
      approved_endpoints: [],
    };
    const denied = new HttpValidatedFetcher({
      guard: guard(new MockResolver(), deniedPolicy),
      budget: new CrawlBudget(spec, () => Date.now()),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
    await assert.rejects(
      denied.fetch(`http://127.0.0.1:${server.port}/allowed`, { timeout_ms: 3000, user_agent: "test" }),
      EgressDeniedError,
    );
  } finally {
    await server.close();
  }
});

test("egress integration: redirect-to-private is rejected per hop and never fetched", async () => {
  const server = await startFixtureServer({
    redirects: {
      "/redirect-to-private": "http://192.168.13.37/steal",
      "/redirect-to-metadata": "http://169.254.169.254/latest/meta-data/",
      "/redirect-to-octal": "http://0177.0.0.1/",
    },
  });
  try {
    const policy: EgressPolicyConfig = {
      schemes: ["http"],
      domains: ["127.0.0.1"],
      ports: [server.port],
      approved_endpoints: [{ host: "127.0.0.1", port: server.port, justification: "local fixture" }],
      max_redirect_hops: 5,
    };
    const spec: CrawlBudgetSpec = {
      max_pages: 5,
      max_items: 10,
      max_bytes: 100000,
      max_depth: 1,
      wall_time_ms: 5000,
      max_retries_per_request: 0,
      retry_backoff_base_ms: 1,
      max_redirect_hops: 5,
    };
    const fetcher = new HttpValidatedFetcher({
      guard: guard(new MockResolver(), policy),
      budget: new CrawlBudget(spec, () => Date.now()),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
    for (const path of ["/redirect-to-private", "/redirect-to-metadata", "/redirect-to-octal"]) {
      await assert.rejects(
        fetcher.fetch(`http://127.0.0.1:${server.port}${path}`, { timeout_ms: 3000, user_agent: "test" }),
        EgressDeniedError,
      );
    }
    // The redirect targets were never contacted (only the first hop hit the fixture).
    assert.equal(server.requests.filter((entry) => entry.url.includes("192.168.13.37")).length, 0);
    assert.equal(server.requests.filter((entry) => entry.url.includes("169.254.169.254")).length, 0);
  } finally {
    await server.close();
  }
});
