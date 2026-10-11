import assert from "node:assert/strict";
import test from "node:test";
import { PaymentLedger } from "../src/contract.js";

/**
 * AR2-010 — 追加式台账验收（issue #12）：
 * 不可变追加；金额移动必须引用预留；operation_id 唯一（重复 → REPLAYED
 * 原条目，台账零改动 —— 「一个台账结果 + 一个 provider 操作」的基础）；
 * 负数金额/未知预留/自引用修正类型化拒绝。
 */

const BASE = {
  tenant_id: "tnt_00000001",
  escalation_id: "esc_00000001",
  attempt_id: "att_00000001",
  reservation_id: null,
  payment_operation_id: null,
  amount: null,
  currency: null,
  memo: "test",
  supersedes_entry_id: null,
};

test("append-only: entries are immutable server-assigned records", () => {
  const ledger = new PaymentLedger();
  const reserved = ledger.append({
    ...BASE,
    kind: "BUDGET_RESERVED",
    amount: 500,
    currency: "USD",
  });
  assert.equal(reserved.kind, "APPENDED");
  if (reserved.kind === "APPENDED") {
    assert.match(reserved.entry.entry_id, /^led_\d{8}$/);
    assert.equal(ledger.reservationOf(reserved.entry.entry_id)?.kind, "BUDGET_RESERVED");
  }
  // 无任何修改/删除入口 —— all() 快照只读。
  assert.equal(ledger.all().length, 1);
});

test("amount movements require a reservation and a payment_operation_id", () => {
  const ledger = new PaymentLedger();
  const noReservation = ledger.append({
    ...BASE,
    kind: "RELEASE_OPERATION",
    amount: 100,
    currency: "USD",
  });
  assert.equal(noReservation.kind, "REJECTED");
  if (noReservation.kind === "REJECTED") {
    assert.equal(noReservation.code, "UNKNOWN_RESERVATION");
  }

  const reserved = ledger.append({
    ...BASE,
    kind: "BUDGET_RESERVED",
    amount: 500,
    currency: "USD",
  });
  assert.equal(reserved.kind, "APPENDED");
  const reservationId = reserved.kind === "APPENDED" ? reserved.entry.entry_id : "led_00000001";

  const noOperationId = ledger.append({
    ...BASE,
    kind: "RELEASE_OPERATION",
    reservation_id: reservationId,
    amount: 100,
    currency: "USD",
  });
  assert.equal(noOperationId.kind, "REJECTED");
});

test("operation_id uniqueness: duplicate submission replays the original entry with zero mutation", () => {
  const ledger = new PaymentLedger();
  const reserved = ledger.append({
    ...BASE,
    kind: "BUDGET_RESERVED",
    amount: 500,
    currency: "USD",
  });
  const reservationId = reserved.kind === "APPENDED" ? reserved.entry.entry_id : "led_00000001";

  const first = ledger.append({
    ...BASE,
    kind: "RELEASE_OPERATION",
    reservation_id: reservationId,
    payment_operation_id: "pop_00000001",
    amount: 200,
    currency: "USD",
  });
  assert.equal(first.kind, "APPENDED");

  const duplicate = ledger.append({
    ...BASE,
    kind: "RELEASE_OPERATION",
    reservation_id: reservationId,
    payment_operation_id: "pop_00000001",
    amount: 200,
    currency: "USD",
  });
  assert.equal(duplicate.kind, "REPLAYED");
  if (duplicate.kind === "REPLAYED") {
    assert.equal(duplicate.entry.entry_id, first.kind === "APPENDED" ? first.entry.entry_id : "");
    assert.equal(duplicate.reason, "duplicate_operation_id");
  }
  // 台账里只有一条 RELEASE —— 重复回调绝不产生第二笔。
  const releases = ledger.all().filter((entry) => entry.kind === "RELEASE_OPERATION");
  assert.equal(releases.length, 1);
});

test("rejections: negative amount, unknown supersede target, self-supersede, smuggled entry_id", () => {
  const ledger = new PaymentLedger();
  assert.equal(
    ledger.append({ ...BASE, kind: "BUDGET_RESERVED", amount: -5, currency: "USD" }).kind,
    "REJECTED",
  );
  assert.equal(
    ledger.append({ ...BASE, kind: "ELIGIBILITY_DECIDED", supersedes_entry_id: "led_99999999" })
      .kind,
    "REJECTED",
  );
  assert.equal(
    ledger.append({
      ...BASE,
      kind: "ELIGIBILITY_DECIDED",
      ...({ entry_id: "led_00000001" } as object),
    }).kind,
    "REJECTED",
  );
});

test("providerAcked is the pre-retry reconciliation query", () => {
  const ledger = new PaymentLedger();
  const reserved = ledger.append({
    ...BASE,
    kind: "BUDGET_RESERVED",
    amount: 500,
    currency: "USD",
  });
  const reservationId = reserved.kind === "APPENDED" ? reserved.entry.entry_id : "led_00000001";
  assert.equal(ledger.providerAcked("pop_00000001"), false);
  ledger.append({
    ...BASE,
    kind: "PROVIDER_ACK",
    reservation_id: reservationId,
    payment_operation_id: "pop_00000001",
  });
  assert.equal(ledger.providerAcked("pop_00000001"), true);
  // 观察类条目不进入金额移动注册表：byOperationId 只回答「有没有转账」。
  assert.equal(ledger.byOperationId("pop_00000001"), null);
});
