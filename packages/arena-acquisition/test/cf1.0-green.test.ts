import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTRACT_CORPUS_VERSION,
  CONTRACT_VERSION,
  arenaErrorCodeSchema,
  arenaIdSchema,
  acceptanceCriterionSchema,
  tenantContextSchema,
} from "@arena/contracts";
import {
  ACQUISITION_SCHEMA_FAMILY,
  acqErrorCodeSchema,
  checkCapabilityAcquisitionRequest,
  checkCapabilityGapReport,
} from "../src/contract.js";
import { acquisitionRequest, gapReport } from "./fixtures.js";

/**
 * AR2-016 验收（issue #32）：冻结 CF1.0 语料保持 green 且两家族严格分离 ——
 * 共享形状（TenantContext、验收 criterion、基础 primitive）经 @arena/contracts
 * 公共入口复用且仍然解析；ACQ_* 与 ARENA_* 错误码空间互不相交；
 * ACQ1.0 载荷在版本门上绝不接受 CF1.0；本包对 CF1.0 只读。
 */

test("cf1.0 green: the frozen corpus version constants are unchanged", () => {
  assert.equal(CONTRACT_CORPUS_VERSION, "CF1.0");
  assert.equal(CONTRACT_VERSION, "ES2.0");
});

test("cf1.0 green: shared shapes still parse the ACQ1.0 fixture payloads (public entrypoint reuse)", () => {
  const request = acquisitionRequest();
  assert.ok(tenantContextSchema.safeParse(request.tenant_context).success);
  assert.ok(acceptanceCriterionSchema.safeParse(request.acceptance_criteria[0]).success);
  assert.ok(arenaIdSchema.safeParse(request.request_id).success);
  assert.ok(arenaIdSchema.safeParse(gapReport().report_id).success);

  // The frozen primitive still rejects what it always rejected.
  assert.equal(arenaIdSchema.safeParse("short").success, false);
  assert.equal(arenaIdSchema.safeParse("bad id with spaces!").success, false);
});

test("cf1.0 green: ACQ_* codes are a separate space from the frozen ARENA_* catalog", () => {
  const cf1Codes = arenaErrorCodeSchema.options;
  const acqCodes = acqErrorCodeSchema.options;
  const overlap = acqCodes.filter((code) => (cf1Codes as readonly string[]).includes(code));
  assert.deepEqual(overlap, []);

  // Each family recognizes only its own codes.
  assert.ok(arenaErrorCodeSchema.safeParse("ACQ_ROUTE_BLOCKED").success === false);
  assert.ok(arenaErrorCodeSchema.safeParse("ARENA_UNKNOWN_FIELD").success);
  assert.ok(acqErrorCodeSchema.safeParse("ARENA_UNKNOWN_FIELD").success === false);
  assert.ok(acqErrorCodeSchema.safeParse("ACQ_ROUTE_BLOCKED").success);
});

test("cf1.0 green: ACQ1.0 envelopes never accept a CF1.0 schema_version", () => {
  const gapWithCf = checkCapabilityGapReport({ ...gapReport(), schema_version: "CF1.0" });
  assert.equal(gapWithCf.ok, false);
  if (!gapWithCf.ok) assert.equal(gapWithCf.code, "ACQ_SCHEMA_VERSION_UNSUPPORTED");

  const requestWithCf = checkCapabilityAcquisitionRequest({
    ...acquisitionRequest(),
    schema_version: "CF1.0",
  });
  assert.equal(requestWithCf.ok, false);
  if (!requestWithCf.ok) assert.equal(requestWithCf.code, "ACQ_SCHEMA_VERSION_UNSUPPORTED");
});

test("cf1.0 green: the ACQ family id is distinct from every frozen family id", () => {
  assert.equal(ACQUISITION_SCHEMA_FAMILY, "ACQ1.0");
  assert.notEqual(ACQUISITION_SCHEMA_FAMILY, CONTRACT_CORPUS_VERSION);
  assert.notEqual(ACQUISITION_SCHEMA_FAMILY, CONTRACT_VERSION);
});
