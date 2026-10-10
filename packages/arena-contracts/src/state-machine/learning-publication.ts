import type { StateMachineDefinition } from "./machine.js";

/**
 * A11 — Learning 发布状态机（ES2.0 §6 不变量 8；architecture-lock 第 14 条）。
 * 立即客户结果与可复用学习制品是不同产品；复用需要显式 rights、
 * provenance、（需要时的）consent、scope、validation 与发布审批。
 * 新学习产生新版本/proposal，绝不改写既有证据。
 */

export const LEARNING_STATES = [
  "PROPOSED",
  "UNDER_REVIEW",
  "RIGHTS_CLEARED",
  "CONSENT_RECORDED",
  "VALIDATED",
  "APPROVED",
  "PUBLISHED",
  "RETRACTED",
  "REJECTED",
] as const;

export type LearningState = (typeof LEARNING_STATES)[number];

/** 不变量 8 的五项检查（ES2.0 §6）。 */
export const PUBLICATION_GUARDS = [
  "rights_verified",
  "provenance_verified",
  "validation_passed",
  "scope_verified",
  "consent_verified",
] as const;

export const learningStateMachine: StateMachineDefinition<LearningState> = {
  id: "learning-publication",
  initial: "PROPOSED",
  states: LEARNING_STATES,
  terminals: ["RETRACTED", "REJECTED"],
  transitions: [
    {
      from: "PROPOSED",
      to: "UNDER_REVIEW",
      command: "SystemPublishLearning",
      guards: ["proposal_versioned"],
    },
    {
      from: "UNDER_REVIEW",
      to: "RIGHTS_CLEARED",
      command: "SystemPublishLearning",
      guards: ["rights_verified"],
    },
    {
      from: "RIGHTS_CLEARED",
      to: "CONSENT_RECORDED",
      command: "SystemPublishLearning",
      guards: ["consent_verified"],
    },
    {
      from: "CONSENT_RECORDED",
      to: "VALIDATED",
      command: "SystemPublishLearning",
      guards: ["provenance_verified", "validation_passed"],
    },
    {
      from: "VALIDATED",
      to: "APPROVED",
      command: "SystemPublishLearning",
      guards: ["scope_verified", "publication_approved"],
    },
    {
      from: "APPROVED",
      to: "PUBLISHED",
      command: "SystemPublishLearning",
      guards: [...PUBLICATION_GUARDS],
    },
    {
      from: "PROPOSED",
      to: "REJECTED",
      command: "SystemPublishLearning",
      guards: ["rejection_reason_recorded"],
    },
    {
      from: "UNDER_REVIEW",
      to: "REJECTED",
      command: "SystemPublishLearning",
      guards: ["rejection_reason_recorded"],
    },
    {
      from: "PUBLISHED",
      to: "RETRACTED",
      command: "SystemPublishLearning",
      guards: ["retraction_reason_recorded"],
    },
  ],
  state_docs: {
    PROPOSED: {
      entry: "learning proposal created as a new version",
      exit: "review begins or rejection",
    },
    UNDER_REVIEW: { entry: "reuse review opened", exit: "rights cleared or rejection" },
    RIGHTS_CLEARED: { entry: "explicit reuse rights verified", exit: "consent recorded" },
    CONSENT_RECORDED: {
      entry: "required consents recorded where policy demands",
      exit: "provenance and validation pass",
    },
    VALIDATED: {
      entry: "provenance verified and validation passed",
      exit: "scope verified with publication approval",
    },
    APPROVED: {
      entry: "scope verified and publication approved",
      exit: "published under the full five-check conjunction",
    },
    PUBLISHED: {
      entry: "all five invariant-8 checks passed",
      exit: "retraction (a new record, never a rewrite)",
    },
    RETRACTED: { entry: "published artifact retracted with recorded reason", exit: "terminal" },
    REJECTED: { entry: "proposal rejected with recorded reason", exit: "terminal" },
  },
};
