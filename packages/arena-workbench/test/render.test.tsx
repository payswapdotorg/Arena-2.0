import assert from "node:assert/strict";
import test from "node:test";
// tsx 对 include 之外的测试文件使用 classic JSX runtime（src/ 内为 automatic）；
// 显式值导入 React 使两种 runtime 产物兼容。
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DemoBanner,
  FieldErrorList,
  RequesterCockpit,
  RoleSwitcher,
  StateBadge,
  WORKBENCH_DEMO_DISCLOSURE,
} from "../src/contract.js";

/**
 * AR2-003 slice 1 SSR 冒烟（node:test + renderToStaticMarkup；无浏览器依赖）。
 * 验收场景 4/5/6 的渲染面：DEMO 标注、透镜切换可达性、状态徽章
 * （含 unknown 失败关闭）、表单错误呈现、空/加载态。
 */

test("render: demo banner is visible and labelled (architecture-lock 23)", () => {
  const html = renderToStaticMarkup(<DemoBanner />);
  assert.match(html, /DEMO — deterministic fixtures, never customer state/);
  assert.match(html, /data-demo="true"/);
  assert.match(html, /role="note"/);
  assert.equal(WORKBENCH_DEMO_DISCLOSURE.includes("never customer state"), true);
});

test("render: role switcher exposes aria-pressed per lens and the rule assertion", () => {
  const html = renderToStaticMarkup(
    <RoleSwitcher selected="requester" onSelect={() => undefined} />,
  );
  assert.match(html, /aria-pressed="true"[^>]*>Requester cockpit/);
  assert.match(html, /aria-pressed="false"[^>]*>Expert workbench/);
  assert.match(html, /data-role-is-not-authorization="true"/);
  assert.match(html, /aria-label="workbench lens"/);
});

test("render: state badge renders frozen states and fails closed on unknown", () => {
  const verifying = renderToStaticMarkup(<StateBadge machine="escalation" state="VERIFYING" />);
  assert.match(verifying, /Verifying/);
  assert.match(verifying, /arena-state-active/);
  const closed = renderToStaticMarkup(<StateBadge machine="escalation" state="CLOSED" />);
  assert.match(closed, /arena-state-terminal/);
  const unknown = renderToStaticMarkup(<StateBadge machine="escalation" state="HACKED" />);
  assert.match(unknown, /unknown \(no invented states\)/);
  assert.match(unknown, /data-unknown-state="HACKED"/);
});

test("render: field errors list surfaces typed per-field errors", () => {
  const html = renderToStaticMarkup(
    <FieldErrorList
      errors={[
        { field: "budget.limit_amount", rule: "invalid_type — must be positive" },
        { field: "tenant_id", rule: "unknown draft field (strict)" },
      ]}
    />,
  );
  assert.match(html, /aria-label="form validation errors"/);
  assert.match(html, /budget\.limit_amount/);
  assert.match(html, /tenant_id/);
});

test("render: requester cockpit shows demo banner, form fields, error list and empty tracking", () => {
  const html = renderToStaticMarkup(
    <RequesterCockpit
      lens="requester"
      title="Fix pricing rule edge cases"
      outcomeDescription="Corrected rule reproduces the fixture table"
      budgetLimit="500"
      errors={[{ field: "budget.limit_amount", rule: "invalid_type — must be positive" }]}
      tracking={[]}
      onSubmit={() => undefined}
      onTitleChange={() => undefined}
      onOutcomeChange={() => undefined}
      onBudgetChange={() => undefined}
    />,
  );
  assert.match(html, /DEMO — deterministic fixtures/);
  assert.match(html, /aria-label="requester cockpit"/);
  assert.match(html, /id="arena-task-title"/);
  assert.match(html, /id="arena-budget-limit"/);
  assert.match(html, /No escalations yet \(empty state\)/);
  assert.match(html, /budget\.limit_amount/);
});

test("render: requester cockpit tracking list renders escalation summaries with state badges", () => {
  const html = renderToStaticMarkup(
    <RequesterCockpit
      lens="requester"
      title=""
      outcomeDescription=""
      budgetLimit=""
      errors={[]}
      tracking={[
        {
          escalation_id: "esc_00000001",
          title: "Fix pricing rule edge cases",
          state: "CREATED",
          budget_limit: 500,
          currency: "USD",
          deadline: "2026-11-01T00:00:00Z",
          demo: { demo: true, disclosure: WORKBENCH_DEMO_DISCLOSURE },
        },
      ]}
      onSubmit={() => undefined}
      onTitleChange={() => undefined}
      onOutcomeChange={() => undefined}
      onBudgetChange={() => undefined}
    />,
  );
  assert.match(html, /data-escalation="esc_00000001"/);
  assert.match(html, /arena-state-pending/);
  assert.match(html, /500 USD/);
});
