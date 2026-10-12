import { isIP } from "node:net";
import type { ScrpErrorCode } from "../errors.js";

/**
 * AR2-017 — Egress guard: SSRF / DNS-rebinding defense (issue #33; spec §6).
 *
 * Validates EVERY requested URL and EVERY redirect hop and every resolved
 * destination at connection time:
 * - allowlist schemes (http/https only), domains (exact + *.wildcard) and ports;
 * - DNS resolution with rejection of loopback (127/8, ::1), link-local
 *   (169.254/16, fe80::/10), private (10/8, 172.16/12, 192.168/16, fc00::/7),
 *   reserved/zeroconf (0.0.0.0/8, 100.64/10), cloud metadata
 *   (169.254.169.254, metadata.google.internal, 169.254.170.2) and unapproved
 *   egress — for BOTH IPv4 and IPv6, including IPv4-mapped IPv6 and octal/
 *   decimal/homograph host forms (WHATWG URL canonicalization + allowlist
 *   matching make those unrepresentable);
 * - fail closed on ANY resolution ambiguity (empty/failed/ambiguous lookups).
 *
 * IP-literal destinations are allowed ONLY as explicitly approved endpoints
 * (auditable, justification required) — this is how local fixture servers are
 * permitted in tests; production policies leave that list empty.
 */

export interface ApprovedEndpoint {
  host: string;
  port: number;
  justification: string;
}

export interface EgressPolicyConfig {
  schemes: readonly ("http" | "https")[];
  domains: readonly string[];
  ports: readonly number[];
  approved_endpoints: readonly ApprovedEndpoint[];
  max_redirect_hops: number;
}

export interface DnsResolver {
  lookup(host: string, options: { all: true }): Promise<Array<{ address: string; family: number }>>;
}

export type EgressCheck =
  | { ok: true }
  | { ok: false; code: "SCRP_EGRESS_DENIED"; detail: string };

export const EGRESS_FAIL_CLOSED_RULE =
  "the egress guard fails closed on any ambiguity: unknown scheme, non-allowlisted domain or port, " +
  "unapproved IP-literal destination, failed/empty DNS resolution, any resolved address in a " +
  "prohibited range, or any redirect hop that fails re-validation";

const METADATA_HOSTNAMES = new Set(["metadata.google.internal", "169.254.170.2", "169.254.169.254"]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number.parseInt(part, 10);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

function ipv6ToBigInt(ip: string): bigint | null {
  let text = ip.toLowerCase();
  if (text.startsWith("[")) text = text.slice(1);
  if (text.endsWith("]")) text = text.slice(0, -1);
  // Embedded IPv4 tail (::ffff:127.0.0.1) — convert to hex groups.
  const v4Match = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Match) {
    const v4 = ipv4ToInt(v4Match[2] ?? "");
    if (v4 === null) return null;
    const hex = `${((v4 >>> 16) & 0xffff).toString(16)}:${(v4 & 0xffff).toString(16)}`;
    text = `${v4Match[1] ?? ""}${hex}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parseGroups = (side: string): number[] | null => {
    if (side === "") return [];
    const groups = side.split(":");
    const out: number[] = [];
    for (const group of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      out.push(Number.parseInt(group, 16));
    }
    return out;
  };
  const left = parseGroups(halves[0] ?? "");
  const right = halves.length === 2 ? parseGroups(halves[1] ?? "") : null;
  if (left === null || right === null) return null;
  const missing = 8 - left.length - (right ?? []).length;
  if (missing < 0) return null;
  const groups =
    halves.length === 2
      ? [...left, ...Array<number>(missing).fill(0), ...(right ?? [])]
      : left;
  if (groups.length !== 8) return null;
  let value = 0n;
  for (const group of groups) value = (value << 16n) | BigInt(group);
  return value;
}

/** Prohibited IPv4 ranges (CIDR list; metadata endpoints fall inside 169.254/16). */
const PROHIBITED_IPV4: ReadonlyArray<{ prefix: number; bits: number; label: string }> = [
  { prefix: ipv4ToInt("0.0.0.0")!, bits: 8, label: "reserved/zeroconf 0.0.0.0/8" },
  { prefix: ipv4ToInt("10.0.0.0")!, bits: 8, label: "private 10/8" },
  { prefix: ipv4ToInt("100.64.0.0")!, bits: 10, label: "shared/CGNAT 100.64/10" },
  { prefix: ipv4ToInt("127.0.0.0")!, bits: 8, label: "loopback 127/8" },
  { prefix: ipv4ToInt("169.254.0.0")!, bits: 16, label: "link-local 169.254/16 (cloud metadata)" },
  { prefix: ipv4ToInt("172.16.0.0")!, bits: 12, label: "private 172.16/12" },
  { prefix: ipv4ToInt("192.168.0.0")!, bits: 16, label: "private 192.168/16" },
  { prefix: ipv4ToInt("224.0.0.0")!, bits: 4, label: "multicast 224/4" },
  { prefix: ipv4ToInt("240.0.0.0")!, bits: 4, label: "reserved 240/4" },
];

/** Prohibited IPv6 ranges (128-bit prefixes). */
const PROHIBITED_IPV6: ReadonlyArray<{ prefix: bigint; bits: number; label: string }> = [
  { prefix: 0n, bits: 128, label: "unspecified ::" },
  { prefix: 1n, bits: 128, label: "loopback ::1" },
  { prefix: 0xfe80n << 112n, bits: 10, label: "link-local fe80::/10" },
  { prefix: 0xfc00n << 112n, bits: 7, label: "private fc00::/7" },
  { prefix: 0xff00n << 112n, bits: 8, label: "multicast ff00::/8" },
  { prefix: 0xffffn << 96n, bits: 96, label: "IPv4-mapped ::ffff:0:0/96" },
  { prefix: 0x64ff9bn << 96n, bits: 96, label: "NAT64 64:ff9b::/96" },
];

export function prohibitedIpv4Label(ip: string): string | null {
  const value = ipv4ToInt(ip);
  if (value === null) return "unparsable IPv4 literal";
  for (const range of PROHIBITED_IPV4) {
    const mask = range.bits === 0 ? 0 : (0xffffffff << (32 - range.bits)) >>> 0;
    if (((value & mask) >>> 0) === ((range.prefix & mask) >>> 0)) return range.label;
  }
  return null;
}

export function prohibitedIpv6Label(ip: string): string | null {
  const value = ipv6ToBigInt(ip);
  if (value === null) return "unparsable IPv6 literal";
  for (const range of PROHIBITED_IPV6) {
    const mask = ((1n << BigInt(range.bits)) - 1n) << BigInt(128 - range.bits);
    if ((value & mask) === range.prefix) return range.label;
  }
  // IPv4-mapped: also judge the embedded IPv4 by the v4 rules.
  if ((value >> 32n) === 0xffffn) {
    const embedded = Number(value & 0xffffffffn);
    const dotted = `${(embedded >>> 24) & 0xff}.${(embedded >>> 16) & 0xff}.${(embedded >>> 8) & 0xff}.${embedded & 0xff}`;
    const label = prohibitedIpv4Label(dotted);
    if (label !== null) return `IPv4-mapped ${dotted} (${label})`;
  }
  return null;
}

/** Prohibited-address check for both families. */
export function prohibitedAddressLabel(address: string): string | null {
  const family = isIP(address);
  if (family === 4) return prohibitedIpv4Label(address);
  if (family === 6) return prohibitedIpv6Label(address);
  return "not an IP literal";
}

export function domainMatchesAllowlist(hostname: string, allowed: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  for (const entry of allowed) {
    const rule = entry.toLowerCase();
    if (rule.startsWith("*.")) {
      const suffix = rule.slice(1);
      if (host.endsWith(suffix) && !host.slice(0, host.length - suffix.length).includes(".")) {
        return true;
      }
    } else if (host === rule) {
      return true;
    }
  }
  return false;
}

function approvedEndpointFor(
  host: string,
  port: number,
  policy: EgressPolicyConfig,
): ApprovedEndpoint | null {
  for (const endpoint of policy.approved_endpoints) {
    if (endpoint.host === host && endpoint.port === port) return endpoint;
  }
  return null;
}

export class EgressGuard {
  readonly policy: EgressPolicyConfig;
  private readonly resolver: DnsResolver;

  constructor(options: { policy: EgressPolicyConfig; resolver: DnsResolver }) {
    this.policy = options.policy;
    this.resolver = options.resolver;
  }

  /** Syntax/scope validation of a URL string (no DNS — used per redirect hop too). */
  validateUrlSyntax(url: string): EgressCheck {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, code: "SCRP_EGRESS_DENIED", detail: `unparsable URL: ${url}` };
    }
    const scheme = parsed.protocol.replace(":", "");
    if (!this.policy.schemes.includes(scheme as "http" | "https")) {
      return { ok: false, code: "SCRP_EGRESS_DENIED", detail: `scheme ${scheme} is not allowlisted` };
    }
    if (parsed.username !== "" || parsed.password !== "") {
      return { ok: false, code: "SCRP_EGRESS_DENIED", detail: "URL userinfo is not permitted" };
    }
    const portNumber =
      parsed.port === "" ? (scheme === "https" ? 443 : 80) : Number.parseInt(parsed.port, 10);
    if (!this.policy.ports.includes(portNumber)) {
      return { ok: false, code: "SCRP_EGRESS_DENIED", detail: `port ${portNumber} is not allowlisted` };
    }
    const host = parsed.hostname.toLowerCase();
    if (METADATA_HOSTNAMES.has(host)) {
      return { ok: false, code: "SCRP_EGRESS_DENIED", detail: `cloud metadata host ${host} is prohibited` };
    }
    const family = isIP(host);
    if (family !== 0) {
      // IP literal: only explicitly approved endpoints (auditable) may pass.
      const approved = approvedEndpointFor(host, portNumber, this.policy);
      if (approved === null) {
        const label = prohibitedAddressLabel(host);
        return {
          ok: false,
          code: "SCRP_EGRESS_DENIED",
          detail: `IP-literal destination ${host} is not an approved endpoint${label ? ` (${label})` : ""}`,
        };
      }
      return { ok: true };
    }
    if (!/^[a-z0-9.-]+$/.test(host)) {
      return {
        ok: false,
        code: "SCRP_EGRESS_DENIED",
        detail: `hostname ${host} is not an ASCII dns-form allowlist candidate (homograph defense)`,
      };
    }
    if (!domainMatchesAllowlist(host, this.policy.domains)) {
      return { ok: false, code: "SCRP_EGRESS_DENIED", detail: `host ${host} is not in the domain allowlist` };
    }
    return { ok: true };
  }

  /** Resolve a hostname and validate every resolved address (fail closed). */
  async resolveDestination(host: string): Promise<EgressCheck> {
    let addresses: Array<{ address: string; family: number }>;
    try {
      addresses = await this.resolver.lookup(host, { all: true });
    } catch (error) {
      return {
        ok: false,
        code: "SCRP_EGRESS_DENIED",
        detail: `DNS resolution failed for ${host} (fail closed): ${String(error)}`,
      };
    }
    if (addresses.length === 0) {
      return { ok: false, code: "SCRP_EGRESS_DENIED", detail: `empty DNS resolution for ${host} (fail closed)` };
    }
    for (const { address } of addresses) {
      const label = prohibitedAddressLabel(address);
      if (label !== null) {
        return {
          ok: false,
          code: "SCRP_EGRESS_DENIED",
          detail: `${host} resolves to prohibited destination ${address} (${label})`,
        };
      }
    }
    return { ok: true };
  }

  /** Full validation: syntax/scope + DNS resolution (used per hop, pre-connection). */
  async validateUrl(url: string): Promise<EgressCheck> {
    const syntax = this.validateUrlSyntax(url);
    if (!syntax.ok) return syntax;
    const host = new URL(url).hostname.toLowerCase();
    if (isIP(host) !== 0) return { ok: true }; // literal — checked syntactically
    return this.resolveDestination(host);
  }

  /**
   * net.connect-compatible `lookup` that validates every resolved address
   * AT CONNECTION TIME (DNS-rebinding defense). One resolution, validated,
   * passed through — any prohibited or ambiguous result aborts the socket.
   */
  connectionLookup(
    host: string,
    options: { all?: boolean },
    callback: (
      err: Error | null,
      address?: string | Array<{ address: string; family: number }>,
      family?: number,
    ) => void,
  ): void {
    this.resolver
      .lookup(host, { all: true })
      .then((addresses) => {
        if (addresses.length === 0) {
          callback(new Error("SCRP_EGRESS_DENIED: empty resolution at connection time (fail closed)"));
          return;
        }
        for (const { address } of addresses) {
          const label = prohibitedAddressLabel(address);
          if (label !== null) {
            callback(new Error(`SCRP_EGRESS_DENIED: ${host} resolves to prohibited destination ${address} (${label})`));
            return;
          }
        }
        if (options.all) {
          callback(null, addresses);
        } else {
          const first = addresses[0]!;
          callback(null, first.address, first.family);
        }
      })
      .catch((error) => {
        callback(new Error(`SCRP_EGRESS_DENIED: connection-time resolution failed for ${host} (fail closed): ${String(error)}`));
      });
  }
}

export const egressDeniedCode: ScrpErrorCode = "SCRP_EGRESS_DENIED";
