import type { CapsuleManifest } from "@arena/contracts";
import type { AcquisitionRun } from "../acquisition-run.js";
import type { ScraperDefinition, ScraperVersion } from "../scraper-definition.js";

/**
 * AR2-017 — Capsule execution manifest builder (issue #33; spec §4/§6).
 *
 * Scraper runs execute THROUGH a CapsuleProvider (never raw OS processes):
 * the run's runtime + egress policy + dependency lock + budget are pinned in
 * a CF1.0 CapsuleManifest and provisioned via the capsule port. The SYNTHETIC
 * provider is acceptable for tests; production isolation is a separate release
 * gate and is NOT claimed here (CAPSULE_FAIL_CLOSED_RULE).
 */

/** Synthetic-provider conformance digest (disclosed NON-PRODUCTION evidence). */
export const SYNTHETIC_ISOLATION_SUITE_DIGEST = "5f4dcc3b5aa765d61d8327deb882cf99a8f7c4c2e6e1f9b5a3c8d0f1e2b3c4d5";

export interface CapsuleManifestInput {
  run: AcquisitionRun;
  definition: ScraperDefinition;
  version: ScraperVersion;
  manifestId: string;
  capsuleId: string;
}

export function buildScraperCapsuleManifest(input: CapsuleManifestInput): CapsuleManifest {
  const { run, definition, version } = input;
  const manifest: CapsuleManifest = {
    manifest_id: input.manifestId,
    capsule_id: input.capsuleId,
    manifest_version: 1,
    tenant_id: run.tenant_id,
    // The CF1.0 shape names escalation aggregates; the scraper plane links its
    // ACQ aggregate through these immutable references.
    escalation_id: run.request_id,
    attempt_id: run.correlation_id,
    environment: {
      environment_ref: `arena-scraper-engine@SCRP-ENGINE1.0/crawlee@${definition.runtime_requirements.crawlee_version}`,
      toolchain_pins: definition.dependency_lock.map((entry) => `${entry.name}@${entry.version}`),
      workspace_init: "declarative build plan only — generated scraper code is never executed",
    },
    permitted_actions: [
      {
        action_id: "act_http_crawl",
        tool: "http-crawl",
        scope: `crawl within ${definition.source_scope.domains.join(", ")} under the pinned egress policy`,
        command_allowlist: ["node"],
      },
    ],
    resource_policy: {
      cpu_limit: 2,
      memory_limit_mb: 1024,
      disk_limit_mb: 2048,
      max_duration_seconds: definition.resource_policy.wall_time_seconds,
    },
    egress_policy: {
      denied_default: true,
      allowed_hosts: [...definition.source_scope.domains],
      allow_ingress: false,
    },
    credentials: [],
    lifecycle: {
      provisioning_timeout_seconds: 30,
      heartbeat_interval_seconds: 5,
      teardown_timeout_seconds: 30,
    },
    assurance: {
      isolation_class: "process",
      conformance_suite_digest: SYNTHETIC_ISOLATION_SUITE_DIGEST,
      conformance_suite_version: "1.0.0",
      verified_at: version.released_at,
      provider_id: "prv_synthetic_local",
    },
    artifact_transfer: {
      transfer: "push_scoped",
      max_artifact_bytes: Math.max(1024, definition.resource_policy.max_bytes),
    },
    content_digest: version.build_digest,
  };
  return manifest;
}

/** Honest disclosure: the synthetic capsule is not production isolation. */
export const SYNTHETIC_CAPSULE_DISCLOSURE =
  "scraper runs provision through the CapsuleProvider seam; AR2-017 tests use the SYNTHETIC local " +
  "provider, which makes no OS-isolation claim — production untrusted execution stays disabled until " +
  "the system-level isolation conformance suite passes";
