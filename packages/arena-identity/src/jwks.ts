/**
 * IDN1.0 JWKS 客户端（AR2-022）。
 *
 * 生产代表性参考实现的密钥面：
 * - JWKS 端点仅经配置进入（环境变量/显式构造），无内建端点猜测；
 * - 按 kid 索引 + TTL 缓存 + 单飞（single-flight）刷新；
 * - 未知 kid ⇒ 触发一次刷新（密钥轮换窗口）；刷新后仍未知 ⇒ fail-closed；
 * - 网络/超时/非200/JSON/形状错误 ⇒ fail-closed（IDN_KEY_UNAVAILABLE），
 *   绝不回退到「上一次的旧密钥」之外的任何猜测；
 * - 缓存过期后的取键：惰性重取；取键失败时旧密钥在 TTL 宽限内可用
 *   （轮换期可用性），但新 kid 永远强制刷新；
 * - 状态面（lastFetchOk/时间戳/键数）供 /readyz 投影，不含任何凭据值。
 */

import { isRsaSigningJwk, type RsaJwk } from "./jwt.js";

export interface JwksClientOptions {
  uri: string;
  /** 请求超时（毫秒）。 */
  timeoutMs?: number;
  /** 缓存 TTL（毫秒）；过期后首次取键触发重取。 */
  cacheTtlMs?: number;
  /** 注入测试用 fetch（默认 globalThis.fetch）。 */
  fetchImpl?: typeof fetch;
}

export interface JwksState {
  lastFetchAt: number | null;
  lastFetchOk: boolean;
  lastErrorKind: string | null;
  keyCount: number;
}

interface CachedKeySet {
  keys: Map<string, RsaJwk>;
  fetchedAt: number;
}

export interface JwksClient {
  /** 取验证密钥：未知 kid 强制刷新一次；失败 fail-closed 抛 JwksUnavailableError。 */
  getSigningKey(kid: string | undefined): Promise<RsaJwk>;
  /** 强制刷新（启动探测/轮换事件）。 */
  refresh(): Promise<void>;
  /** 状态投影（无凭据值）。 */
  state(): JwksState;
}

/** fail-closed 密钥不可用（统一归一为 IDN_KEY_UNAVAILABLE）。 */
export class JwksUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JwksUnavailableError";
  }
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_MS = 600_000;

export function createJwksClient(options: JwksClientOptions): JwksClient {
  const uri = options.uri;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const doFetch = options.fetchImpl ?? globalThis.fetch;

  let cached: CachedKeySet | null = null;
  const state: JwksState = {
    lastFetchAt: null,
    lastFetchOk: false,
    lastErrorKind: null,
    keyCount: 0,
  };
  let inflight: Promise<void> | null = null;

  async function fetchKeySet(): Promise<Map<string, RsaJwk>> {
    let response: Response;
    try {
      response = await doFetch(uri, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
    } catch (error) {
      state.lastErrorKind = error instanceof Error ? error.name : "fetch_error";
      throw new JwksUnavailableError("JWKS endpoint unreachable (fail-closed)");
    }
    if (!response.ok) {
      state.lastErrorKind = `http_${response.status}`;
      throw new JwksUnavailableError(`JWKS endpoint returned HTTP ${response.status}`);
    }
    let parsed: unknown;
    try {
      parsed = (await response.json()) as unknown;
    } catch {
      state.lastErrorKind = "invalid_json";
      throw new JwksUnavailableError("JWKS response is not valid JSON");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      state.lastErrorKind = "invalid_shape";
      throw new JwksUnavailableError("JWKS response is not an object");
    }
    const keys = (parsed as Record<string, unknown>).keys;
    if (!Array.isArray(keys)) {
      state.lastErrorKind = "missing_keys";
      throw new JwksUnavailableError("JWKS response has no keys array");
    }
    const byKid = new Map<string, RsaJwk>();
    let signingKeys = 0;
    for (const key of keys) {
      if (!isRsaSigningJwk(key)) continue;
      signingKeys += 1;
      const kid = key.kid ?? `rsa-${byKid.size}`;
      if (byKid.has(kid)) {
        state.lastErrorKind = "duplicate_kid";
        throw new JwksUnavailableError(`JWKS contains duplicate kid`);
      }
      byKid.set(kid, key);
    }
    if (signingKeys === 0) {
      state.lastErrorKind = "no_signing_keys";
      throw new JwksUnavailableError("JWKS contains no usable RS256 signing keys");
    }
    return byKid;
  }

  async function refresh(): Promise<void> {
    if (inflight !== null) {
      await inflight;
      return;
    }
    const task = (async () => {
      const fresh = await fetchKeySet();
      cached = { keys: fresh, fetchedAt: Date.now() };
      state.lastFetchAt = cached.fetchedAt;
      state.lastFetchOk = true;
      state.lastErrorKind = null;
      state.keyCount = fresh.size;
    })().finally(() => {
      inflight = null;
    });
    inflight = task;
    try {
      await task;
    } catch (error) {
      state.lastFetchOk = false;
      if (cached !== null) {
        // 轮换期可用性：刷新失败但旧密钥集仍在 TTL 宽限内。
        state.keyCount = cached.keys.size;
      } else {
        state.keyCount = 0;
      }
      if (error instanceof JwksUnavailableError) throw error;
      throw new JwksUnavailableError("JWKS refresh failed (fail-closed)");
    }
  }

  function cacheIsUsable(): boolean {
    return cached !== null && Date.now() - cached.fetchedAt <= cacheTtlMs;
  }

  async function getSigningKey(kid: string | undefined): Promise<RsaJwk> {
    if (cached === null) {
      await refresh();
    } else if (!cacheIsUsable()) {
      try {
        await refresh();
      } catch {
        // TTL 过期 + 重取失败 + 旧集仍存在的轮换期宽限：仅当 kid 命中旧集才可用。
        if (kid !== undefined && cached.keys.has(kid)) {
          state.keyCount = cached.keys.size;
        } else {
          throw new JwksUnavailableError("JWKS stale and refresh failed (fail-closed)");
        }
      }
    }
    const set = cached;
    if (set === null) {
      throw new JwksUnavailableError("JWKS not loaded (fail-closed)");
    }
    if (kid === undefined) {
      if (set.keys.size === 1) {
        return [...set.keys.values()][0] as RsaJwk;
      }
      throw new JwksUnavailableError("token has no kid and JWKS has multiple keys");
    }
    const hit = set.keys.get(kid);
    if (hit !== undefined) return hit;
    // 未知 kid：一次强制刷新（密钥轮换窗口），仍未知 ⇒ fail-closed。
    await refresh();
    const fresh = cached?.keys.get(kid);
    if (fresh === undefined) {
      throw new JwksUnavailableError(`kid unknown after refresh (fail-closed)`);
    }
    return fresh;
  }

  return {
    getSigningKey,
    refresh: () => refresh(),
    state: () => ({ ...state }),
  };
}
