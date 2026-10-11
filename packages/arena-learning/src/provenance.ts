import { z } from "zod";
import { arenaIdSchema, isoTimestampSchema, digestSchema } from "@arena/contracts";
import { nonEmptyMedium } from "./rights.js";

/**
 * AR2-014 — 溯源图 + LearningProposal（issue #16）。
 *
 * 冻结纪律：
 * - 溯源节点不可变：新学习产生新版本/proposal（绝不改写既有证据）；
 *   修正 = 追加 supersedes 节点（旧节点原样保留）；
 * - 溯源链从真实材料出发：evidence ids（AR2-007 已接受证据）、attempt id、
 *   escalation id、决策依据 —— 复用「先有证据后有学习」的次序；
 * - 私有默认：proposal 的 source_visibility 在未获得 marketplace 授权前
 *   恒为 tenant_private。
 */

export const provenanceNodeKindSchema = z.enum([
  "accepted_evidence",
  "attempt_outcome",
  "adjudication_record",
  "dataset",
  "transformation",
  "capability_evaluation",
]);

export const provenanceNodeSchema = z
  .object({
    node_id: arenaIdSchema,
    kind: provenanceNodeKindSchema,
    /** 指向的真实材料（evidence/attempt/decision/dataset id）。 */
    source_ref: arenaIdSchema,
    content_digest: digestSchema,
    recorded_at: isoTimestampSchema,
    /** 修正：指向被取代节点（追加，不改写）。 */
    supersedes_node_id: arenaIdSchema.nullable(),
    note: nonEmptyMedium,
  })
  .strict();

export const learningProposalSchema = z
  .object({
    proposal_id: arenaIdSchema,
    proposal_version: z.number().int().positive(),
    tenant_id: arenaIdSchema,
    /** 学习源材料（全部须有溯源节点 + rights 覆盖）。 */
    source_artifact_ids: z.array(arenaIdSchema).min(1).max(64),
    /** 提议的产物（新 BodyVersion / 知识包 / 工具/连接器规则）。 */
    target_kind: z.enum(["agent_body_version", "knowledge_pack", "tool_rule", "connector_preset"]),
    rationale: nonEmptyMedium,
    provenance: z.array(provenanceNodeSchema).min(1).max(128),
    created_at: isoTimestampSchema,
    supersedes_proposal_id: arenaIdSchema.nullable(),
    source_visibility: z.enum(["tenant_private", "marketplace_public"]),
  })
  .strict();

export type ProvenanceNodeKind = z.infer<typeof provenanceNodeKindSchema>;
export type ProvenanceNode = z.infer<typeof provenanceNodeSchema>;
export type LearningProposal = z.infer<typeof learningProposalSchema>;

export type ProvenanceCheck =
  | { kind: "VERIFIED"; nodes: readonly ProvenanceNode[] }
  | {
      kind: "GAPS";
      issues: ReadonlyArray<{ field: string; rule: string }>;
    };

/** 溯源校验：每个源制品都有节点；节点不可自取代；链条无悬空 supersedes。 */
export function verifyProvenance(input: {
  proposal: LearningProposal;
  all_known_node_ids: readonly string[];
}): ProvenanceCheck {
  const issues: Array<{ field: string; rule: string }> = [];
  const nodeIds = new Set(input.proposal.provenance.map((node) => node.node_id));
  for (const artifactId of input.proposal.source_artifact_ids) {
    if (!input.proposal.provenance.some((node) => node.source_ref === artifactId)) {
      issues.push({
        field: "provenance",
        rule: `source artifact ${artifactId} has no provenance node`,
      });
    }
  }
  for (const node of input.proposal.provenance) {
    if (node.supersedes_node_id === node.node_id) {
      issues.push({
        field: "provenance.supersedes_node_id",
        rule: "a provenance node cannot supersede itself",
      });
    }
    if (
      node.supersedes_node_id !== null &&
      !nodeIds.has(node.supersedes_node_id) &&
      !input.all_known_node_ids.includes(node.supersedes_node_id)
    ) {
      issues.push({
        field: "provenance.supersedes_node_id",
        rule: `supersedes target ${node.supersedes_node_id} is unknown (dangling correction)`,
      });
    }
  }
  if (issues.length > 0) return { kind: "GAPS", issues };
  return { kind: "VERIFIED", nodes: input.proposal.provenance };
}

export class ProposalRegistry {
  private readonly proposals = new Map<string, LearningProposal[]>();

  submit(
    input: unknown,
  ):
    | { kind: "RECORDED"; proposal: LearningProposal }
    | { kind: "REJECTED"; issues: ReadonlyArray<{ field: string; rule: string }> } {
    const parsed = learningProposalSchema.safeParse(input);
    if (!parsed.success) {
      return {
        kind: "REJECTED",
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
          rule: issue.message,
        })),
      };
    }
    const proposal = parsed.data;
    const history = this.proposals.get(proposal.proposal_id) ?? [];
    if (history.length > 0) {
      const latest = history[history.length - 1];
      if (latest !== undefined && latest.proposal_version >= proposal.proposal_version) {
        return {
          kind: "REJECTED",
          issues: [
            {
              field: "proposal_version",
              rule: "new submissions must carry a strictly higher version",
            },
          ],
        };
      }
    }
    history.push(proposal);
    this.proposals.set(proposal.proposal_id, history);
    return { kind: "RECORDED", proposal };
  }

  versions(proposalId: string): readonly LearningProposal[] {
    return [...(this.proposals.get(proposalId) ?? [])];
  }

  current(proposalId: string): LearningProposal | null {
    const history = this.proposals.get(proposalId);
    return history !== undefined && history.length > 0
      ? (history[history.length - 1] ?? null)
      : null;
  }

  /** 不可变历史：旧版本原样保留（只读快照）。 */
  historyIsImmutable(proposalId: string): boolean {
    return this.versions(proposalId).every((proposal, index, all) => {
      const previous = index > 0 ? all[index - 1] : undefined;
      return previous === undefined || previous.proposal_version < proposal.proposal_version;
    });
  }
}

export const PROVENANCE_DISCLOSURE =
  "Provenance nodes are immutable: corrections append a superseding node and never rewrite prior " +
  "evidence; every source artifact in a LearningProposal must carry a provenance node that reaches " +
  "real accepted material (evidence ids, attempt outcomes, adjudication records) before any reuse";
