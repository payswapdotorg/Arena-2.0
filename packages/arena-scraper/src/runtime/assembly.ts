import { computeCanonicalDigest } from "@arena/acquisition";
import type { ScraperDefinition, ScraperVersion } from "../scraper-definition.js";
import type {
  DatasetArtifact,
  DatasetItem,
  TransformationStep,
} from "../dataset-artifact.js";
import type { AcquisitionRun } from "../acquisition-run.js";
import { SCRAPER_ENGINE_VERSION } from "../primitives.js";
import type { CrawlResult, CrawledItem } from "./crawler.js";

/**
 * AR2-017 — Dataset assembly (issue #33; spec §2/§6).
 *
 * Deduplicates (URL + content hash), attaches full provenance (source URL,
 * retrieval timestamp, method/version, license/rights assessment,
 * transformation lineage) and emits an IMMUTABLE DatasetArtifact whose object
 * hash anchors the emitted items. Items are emitted in first-observed order
 * (deterministic for the same crawl).
 */

export interface AssembleInput {
  run: AcquisitionRun;
  definition: ScraperDefinition;
  version: ScraperVersion;
  crawl: CrawlResult;
  datasetId: string;
  nowIso: string;
}

export function assembleDataset(input: AssembleInput): DatasetArtifact {
  const seen = new Set<string>();
  const items: DatasetItem[] = [];
  for (const crawled of input.crawl.items) {
    const key = `${cannedUrlKey(crawled.final_url)}:${crawled.content_hash}`;
    if (seen.has(key)) continue; // same URL + same content hash -> one item
    seen.add(key);
    items.push(toDatasetItem(input, crawled));
  }
  const artifact: DatasetArtifact = {
    schema_version: "SCRP1.0",
    dataset_id: input.datasetId,
    tenant_id: input.run.tenant_id,
    run_id: input.run.run_id,
    scraper_version_id: input.version.version_id,
    object_hash: computeCanonicalDigest(items),
    items,
    emitted_at: input.nowIso,
    provenance: {
      definition_digest: input.version.definition_digest,
      build_digest: input.version.build_digest,
      engine: SCRAPER_ENGINE_VERSION,
      crawlee_version: input.crawl.crawlee_version,
      terminal_reason: input.run.terminal_reason ?? "NON_TERMINAL",
    },
  };
  return artifact;
}

function cannedUrlKey(url: string): string {
  // Canonical URL key for dedup: strip the default port and trailing slash on "/".
  try {
    const parsed = new URL(url);
    const port = parsed.port === "" ? "" : `:${parsed.port}`;
    const path = parsed.pathname === "/" && !parsed.search ? "/" : `${parsed.pathname}${parsed.search}`;
    return `${parsed.protocol}//${parsed.hostname}${port}${path}`;
  } catch {
    return url;
  }
}

function toDatasetItem(input: AssembleInput, crawled: CrawledItem): DatasetItem {
  const transformations: TransformationStep[] = [
    ...crawled.transformations,
    { step: "SCHEMA_VALIDATED", detail: `output ${input.definition.output_schema.schema_id}@${input.definition.output_schema.schema_version}` },
  ];
  return {
    item_id: itemIdentifier(input.run.run_id, crawled.final_url, crawled.content_hash),
    source_url: crawled.final_url,
    content_hash: crawled.content_hash,
    retrieved_at: crawled.retrieved_at,
    method: input.definition.acquisition_method,
    method_version: SCRAPER_ENGINE_VERSION,
    license_assessment: input.definition.rights_profile.license_assessment,
    rights_posture: input.definition.rights_profile.source_rights_posture,
    redaction_class: "tenant",
    transformations,
    quarantine_annotations: [...crawled.injection_annotations],
    content: crawled.content,
  };
}

/** Deterministic, collision-resistant item id from the arena id shape. */
function itemIdentifier(runId: string, url: string, contentHash: string): string {
  const digest = computeCanonicalDigest({ run: runId, url, hash: contentHash });
  return `itm_${digest.slice(0, 24)}`;
}
