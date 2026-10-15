import assert from "node:assert/strict";
import test from "node:test";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import {
  ExpertController,
  type ExpertCommandPort,
} from "../../src/screens/expert/controller.js";
import {
  bindingCommandAdapter,
  expertRegistration,
  mockAttemptsAdapter,
} from "../../src/screens/expert/registration.js";
import { ExpertScreen } from "../../src/screens/expert/ExpertScreen.js";
import { DEMO_EXPERT_PRINCIPAL, MockArenaClient } from "@arena/workbench";
import type { ArenaScreenHost } from "../../src/contract.js";
import type { CommandApiOutcome, TransitionCommand } from "@arena/workbench";

/**
 * UIA-001 Lane B — 专家工位渲染 + FIXTURE 旅程测试（react-dom/server +
 * MockArenaClient —— 确定性 fixture，如实标注 DEMO）。
 *
 * 覆盖：加载/空/主流程、队列类型化事实、胶囊入口如实禁用（§2.3）、
 * 候选提交（冻结 attempt 状态机）、结构化自评（全覆盖裁决 + 永不投票）、
 * 支付资格展示、escalation 命令通道类型化失败逐字、零 ZCode 品牌。
 */

function normalize(html: string): string {
  return html.replace(/<!--.*?-->/g, "");
}

const HOST: ArenaScreenHost = {
  lens: "expert",
  port: {
    navigate: () => ({ kind: "navigated", screen: "expert" }),
    activeScreen: () => "expert",
  },
};

function render(controller: ExpertController): string {
  return normalize(renderToString(createElement(ExpertScreen, { host: HOST, controller })));
}

function makeController(options?: { commands?: ExpertCommandPort }) {
  const client = new MockArenaClient();
  const principal = DEMO_EXPERT_PRINCIPAL;
  const commands: ExpertCommandPort =
    options?.commands ?? {
      command: async (): Promise<CommandApiOutcome> => ({ kind: "UNKNOWN_COMMAND" }),
    };
  const controller = new ExpertController({
    attempts: mockAttemptsAdapter(client),
    commands,
    principal,
  });
  return { client, controller, principal };
}

test("initial render shows the honest queue loading state", () => {
  const { controller } = makeController();
  const html = render(controller);
  assert.match(html, /Loading the assignment queue/);
});

test("the demo disclosure renders on the expert surface (attempt projection is demo-tagged)", async () => {
  const { controller } = makeController();
  await controller.loadQueue();
  const html = render(controller);
  assert.match(html, /DEMO — deterministic fixtures, never customer state/);
});

test("queue rows render typed facts with the demo tag; selection opens the workspace", async () => {
  const { controller } = makeController();
  await controller.loadQueue();
  const queueHtml = render(controller);
  assert.match(queueHtml, /att_/);
  assert.match(queueHtml, /DEMO data/);

  const rows = controller.snapshot().queue;
  assert.equal(rows.kind, "ready");
  if (rows.kind === "ready") {
    const attemptId = rows.data[0]?.attempt_id ?? "";
    await controller.selectAttempt(attemptId);
    const html = render(controller);
    assert.match(html, /Task context/);
    assert.match(html, /Capsule entry/);
    assert.match(html, /Candidate submission/);
    assert.match(html, /Structured self-evaluation/);
  }
});

test("capsule entry renders truthfully disabled with the recorded basis (§2.3 FROZEN)", async () => {
  const { controller } = makeController();
  await controller.loadQueue();
  const rows = controller.snapshot().queue;
  if (rows.kind === "ready") {
    await controller.selectAttempt(rows.data[0]?.attempt_id ?? "");
  }
  const html = render(controller);
  assert.match(html, /disabled/);
  assert.match(html, /Untrusted expert execution is DISABLED/);
  assert.match(html, /AR2-019-strict-mode-station-evidence/);
});

test("candidate submission journey (FIXTURE): valid draft → SUBMITTED via the frozen attempt state machine", async () => {
  const { controller } = makeController();
  await controller.loadQueue();
  const rows = controller.snapshot().queue;
  if (rows.kind === "ready") {
    await controller.selectAttempt(rows.data[0]?.attempt_id ?? "");
  }
  controller.setManifest("manifest-content-0001");
  controller.setNotes("first candidate notes");
  await controller.submitCandidate();
  const outcome = controller.snapshot().candidateOutcome ?? "";
  assert.match(outcome, /SUBMITTED candidate v1/);
  const html = render(controller);
  assert.match(html, /SUBMITTED candidate v1/);
});

test("candidate submission failures render typed errors verbatim (REJECTED fail-fast)", async () => {
  const { controller } = makeController();
  await controller.loadQueue();
  const rows = controller.snapshot().queue;
  if (rows.kind === "ready") {
    await controller.selectAttempt(rows.data[0]?.attempt_id ?? "");
  }
  await controller.submitCandidate();
  const snap = controller.snapshot();
  assert.match(snap.candidateOutcome ?? "", /REJECTED/);
  assert.ok(snap.candidateErrors.length > 0);
  assert.match(snap.candidateErrors[0]?.field ?? "", /artifact_manifest|submission_notes/);
  const html = render(controller);
  assert.match(html, /artifact_manifest/);
});

test("structured self-evaluation journey (FIXTURE): full coverage submits; never-a-vote is visible", async () => {
  const { controller } = makeController();
  await controller.loadQueue();
  const rows = controller.snapshot().queue;
  assert.equal(rows.kind, "ready");
  if (rows.kind !== "ready") return;
  // 自评提交流的活体目标 = SUBMITTED 态的 attempt（冻结状态机：SUBMITTED → VERIFYING）。
  const submittedRow = rows.data.find((row) => row.state === "SUBMITTED") ?? rows.data[0];
  await controller.selectAttempt(submittedRow?.attempt_id ?? "");
  const criteria = controller.snapshot().criteria;
  assert.equal(criteria.length, 2);
  for (const criterion of criteria) {
    controller.setSelfEvalEntry(criterion.criterion_id, { decision: "PASS", rationale: "matches the fixture table" });
  }
  await controller.submitSelfEvaluation();
  const outcome = controller.snapshot().selfEvalOutcome ?? "";
  assert.match(outcome, /SUBMITTED self-evaluation/);
  assert.match(outcome, /never an independent vote/);
  const html = render(controller);
  assert.match(html, /never an independent vote/);
  assert.match(html, /data-never-vote="true"/);
});

test("payout panel renders the proof-gated rule and the attempt's typed state", async () => {
  const { controller } = makeController();
  await controller.loadQueue();
  const rows = controller.snapshot().queue;
  if (rows.kind === "ready") {
    await controller.selectAttempt(rows.data[0]?.attempt_id ?? "");
  }
  const html = render(controller);
  assert.match(html, /failed or inconclusive proof never pays/);
  assert.match(html, /test_mode/);
});

test("escalation command path renders typed 409 INVALID_TRANSITION verbatim", async () => {
  const commands: ExpertCommandPort = {
    command: async (
      _escalationId: string,
      command: TransitionCommand,
    ): Promise<CommandApiOutcome> => {
      assert.equal(command, "SubmitIntervention");
      return {
        kind: "INVALID_TRANSITION",
        envelope: {
          code: "ARENA_INVALID_TRANSITION",
          message: "no edge from CREATED via SubmitIntervention",
          correlation_id: "corr_8",
          request_id: null,
          details: null,
        },
      };
    },
  };
  const { controller } = makeController({ commands });
  controller.setInterventionEscalationId("esc_00000001");
  await controller.submitIntervention();
  const html = render(controller);
  assert.match(html, /INVALID_TRANSITION ARENA_INVALID_TRANSITION: no edge from CREATED via SubmitIntervention/);
});

test("empty escalation id renders an honest requirement notice (no invented command)", async () => {
  const { controller } = makeController();
  await controller.submitIntervention();
  const html = render(controller);
  assert.match(html, /an escalation id is required/);
});

test("lens is presentation only — the expert surface renders identically under another lens (no request path change)", async () => {
  const { controller } = makeController();
  await controller.loadQueue();
  const requesterLensHost: ArenaScreenHost = {
    lens: "requester",
    port: HOST.port,
  };
  const htmlExpert = normalize(renderToString(createElement(ExpertScreen, { host: HOST, controller })));
  const htmlRequester = normalize(
    renderToString(createElement(ExpertScreen, { host: requesterLensHost, controller })),
  );
  assert.match(htmlExpert, /Viewing as expert/);
  assert.match(htmlRequester, /Viewing as requester/);
  assert.equal(
    htmlExpert.replace(/Viewing as expert/, "").replace(/data-arena-lens="expert"/, ""),
    htmlRequester.replace(/Viewing as requester/, "").replace(/data-arena-lens="requester"/, ""),
  );
});

test("registration wires the expert screen with typed facts and zero ZCode branding", async () => {
  const { client, principal } = makeController();
  const registration = expertRegistration({
    attempts: mockAttemptsAdapter(client),
    commands: bindingCommandAdapter(
      {
        command: async () => ({ kind: "UNKNOWN_COMMAND" }),
      },
      principal,
    ),
    principal,
  });
  assert.equal(registration.screen, "expert");
  assert.equal(registration.title, "Expert work");
  const html = normalize(renderToString(registration.render(HOST) as never));
  assert.match(html, /data-arena-screen="expert"/);
  assert.doesNotMatch(html, /ZCode/i);
});

test("structural a11y: the workspace surfaces carry roles, labels, and disabled semantics", async () => {
  const { controller } = makeController();
  await controller.loadQueue();
  const rows = controller.snapshot().queue;
  if (rows.kind === "ready") {
    await controller.selectAttempt(rows.data[0]?.attempt_id ?? "");
  }
  const html = render(controller);
  assert.match(html, /aria-label="expert workbench"/);
  assert.match(html, /aria-label="assignment queue/);
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /<label for="arena-expert-manifest">/);
  assert.match(html, /aria-label="structured self-evaluation/);
});
