import assert from "node:assert/strict";
import test from "node:test";
import { ArenaApiClient } from "../src/api-client.js";

/**
 * MAINT-004 (issue #81) — the detached-fetch receiver regression test.
 *
 * ArenaApiClient captures the global fetch and calls it as `this.doFetch(...)`.
 * Browser runtimes (Chromium/Electron renderer — the production WEB app and the
 * production DESKTOP renderer both mount this client through
 * RealWorkbenchBinding) enforce the WebIDL receiver law: a fetch invoked with a
 * receiver that is not the Window throws
 * "TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation".
 * Node's fetch is receiver-insensitive, so this suite installs a WebIDL-law
 * stand-in on globalThis.fetch — a function that reproduces exactly that
 * receiver discipline — and asserts the client's projections still complete
 * through it. Against the pre-fix constructor (`?? fetch`, unbound) the
 * stand-in throws at the call site, raw() swallows it, and the projection
 * returns null — the defect this test pins.
 */

/** A WebIDL-law stand-in for the global fetch (receiver discipline verbatim). */
function webidlLawFetch(this: unknown): Promise<Response> {
  if (this !== globalThis) {
    return Promise.reject(
      new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation (simulated)"),
    );
  }
  return Promise.resolve(
    new Response(JSON.stringify({ items: [], tenant_scope: "tnt_receiver_probe" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

test("MAINT-004: the captured global fetch is receiver-safe — projections complete through the WebIDL receiver law", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = webidlLawFetch as typeof fetch;
  try {
    // The defect shape: construct WITHOUT an injected fetchImpl so the client
    // captures the global (the production web/desktop posture).
    const client = new ArenaApiClient({ baseUrl: "http://receiver-probe.invalid" });
    const listed = await client.listEscalations({ bearerToken: "demo-token-receiver-probe" });

    // Pre-fix: this.doFetch(...) throws Illegal invocation → raw() catches →
    // listEscalations returns null → every projection silently degrades.
    // Post-fix: the captured reference is bound to globalThis → the stand-in
    // accepts the receiver → the marker response maps through.
    assert.ok(listed !== null, "listEscalations must complete (not the swallowed Illegal-invocation null)");
    assert.equal(listed?.tenant_scope, "tnt_receiver_probe");
    assert.deepEqual(listed?.items, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MAINT-004: the receiver law stand-in actually rejects wrong receivers (the guard is real)", async () => {
  // Sanity: the stand-in must throw for a foreign receiver — proving the
  // regression test above would catch the unbound capture. This pins the
  // simulation itself, so a future refactor cannot silently weaken it.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = webidlLawFetch as typeof fetch;
  try {
    const captured = globalThis.fetch;
    const carrier: { doFetch?: typeof fetch } = {};
    carrier.doFetch = captured;
    await assert.rejects(
      () => carrier.doFetch?.("http://receiver-probe.invalid/x"),
      /Illegal invocation/u,
      "calling the captured reference through an object method must reproduce the Chromium law",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MAINT-004: the injected fetchImpl path is unchanged (node-test posture)", async () => {
  const calls: string[] = [];
  const client = new ArenaApiClient({
    baseUrl: "http://injected-probe.invalid",
    fetchImpl: (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ items: [], tenant_scope: "tnt_injected" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  });
  const listed = await client.listEscalations({ bearerToken: "demo-token-injected" });
  assert.ok(listed !== null);
  assert.equal(listed?.tenant_scope, "tnt_injected");
  assert.deepEqual(calls, ["http://injected-probe.invalid/v1/escalations"]);
});
