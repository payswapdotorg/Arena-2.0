import { UpgradeTypedError, upgError, type UpgErrorEnvelope } from "../errors.js";
import type {
  CapabilityStrategy,
  FineTuningAuthorizationChainLike,
  FineTuningStubRecord,
  StrategyApplicabilityInput,
  StrategyBuildInput,
  StrategyBuildOutcome,
} from "./port.js";

/**
 * AR2-018 — AuthorizedFineTuningStrategy (issue #34; spec §7 strategy 5).
 *
 * STUB ONLY — default posture: no model fine-tuning. The stub constructs the
 * proposal shape and REQUIRES the full authorization chain (explicit policy
 * authorization, documented data rights, privacy review record, dataset
 * validation, exact model/version/config, rollback provenance) and then
 * refuses to execute unless every gate is present; with every gate present it
 * still records-not-trains. The stub proves the gate exists, not the
 * training. Fine-tuning packs are structurally absent from UPG1.0 payloads.
 */

export interface FineTuningGateCheck {
  ok: boolean;
  missing_gates: string[];
  envelope: UpgErrorEnvelope | null;
}

/** Gate names (recorded on every stub outcome for audit). */
export const FINE_TUNING_GATES: readonly string[] = [
  "policy_authorized",
  "fine_tuning_use_kind_permitted",
  "approval_reference_present",
  "rights_documented",
  "privacy_review_record",
  "dataset_validated",
  "model_target_pinned",
  "rollback_provenance",
];

export function checkFineTuningGates(
  policy: { fine_tuning_authorized: boolean; fine_tuning_approval_ref: string | null; permitted_use_kinds: readonly string[] },
  authorizationInput: FineTuningAuthorizationChainLike | null | undefined,
): FineTuningGateCheck {
  const authorization = authorizationInput ?? null;
  const missing: string[] = [];
  if (!policy.fine_tuning_authorized) missing.push("policy_authorized");
  if (!policy.permitted_use_kinds.includes("FINE_TUNING")) missing.push("fine_tuning_use_kind_permitted");
  if (policy.fine_tuning_approval_ref === null) missing.push("approval_reference_present");
  if (authorization === null) {
    missing.push("rights_documented", "privacy_review_record", "dataset_validated", "model_target_pinned", "rollback_provenance");
    return { ok: false, missing_gates: missing, envelope: upgError("UPG_FINE_TUNING_NOT_AUTHORIZED", `fine-tuning requires the full authorization chain; missing: ${missing.join(", ")}`) };
  }
  if (authorization.authorized !== true) missing.push("policy_authorized");
  if (authorization.rights_documented !== true) missing.push("rights_documented");
  if (authorization.privacy_review_ref.length < 1) missing.push("privacy_review_record");
  if (authorization.dataset_validation_ref.length < 1) missing.push("dataset_validated");
  if (authorization.model_target.model_id.length < 1 || authorization.model_target.version.length < 1) {
    missing.push("model_target_pinned");
  }
  if (authorization.rollback_provenance_ref.length < 1) missing.push("rollback_provenance");
  if (missing.length > 0) {
    return { ok: false, missing_gates: missing, envelope: upgError("UPG_FINE_TUNING_NOT_AUTHORIZED", `fine-tuning requires the full authorization chain; missing: ${missing.join(", ")}`) };
  }
  return { ok: true, missing_gates: [], envelope: null };
}

export class AuthorizedFineTuningStrategy implements CapabilityStrategy {
  readonly strategy = "AUTHORIZED_FINE_TUNING" as const;

  applicable(input: StrategyApplicabilityInput): { applicable: boolean; reason_code: string } {
    const authorized =
      input.policy.fine_tuning_authorized && input.policy.fine_tuning_approval_ref !== null;
    return authorized
      ? { applicable: true, reason_code: "explicitly_authorized" }
      : { applicable: false, reason_code: "fine_tuning_requires_explicit_authorization" };
  }

  build(input: StrategyBuildInput): StrategyBuildOutcome {
    const authorization = input.fine_tuning_authorization ?? null;
    const check = checkFineTuningGates(input.policy, authorization);
    if (!check.ok || authorization === null) {
      throw new UpgradeTypedError(
        check.envelope ??
          upgError("UPG_FINE_TUNING_NOT_AUTHORIZED", "fine-tuning requires the full authorization chain"),
      );
    }
    const record: FineTuningStubRecord = {
      trained: false,
      recorded: true,
      strategy: "AUTHORIZED_FINE_TUNING",
      gates: FINE_TUNING_GATES.map((gate) => ({ gate, satisfied: true })),
      model_target: authorization.model_target,
      rollback_provenance_ref: authorization.rollback_provenance_ref,
      note:
        "authorized fine-tuning request RECORDED but NOT TRAINED: this stub proves the gate exists, " +
        "not the training; execution requires a separately reviewed training pipeline outside UPG1.0",
    };
    return { kind: "RECORDED_NOT_TRAINED", record };
  }
}
