# Expert Arena: Candidate Submission, Self-Evaluation, and Independent Adjudication

Status: product contract approved; implementation pending.
Version: EA1.0

Expert Arena is an optional but first-class evaluation route for tasks where multiple qualified experts can attempt or evaluate solutions. It works alongside normal expert matching, application-level verification and Arena adjudication. It never replaces the canonical proof-and-payment policy.

## 1. Two distinct paths

### Attempt path

1. Arena creates an immutable competition/task round with a brief, environment snapshot, acceptance criteria, proof class, deadline, budget, privacy policy and allowed tools.
2. Eligible experts receive equalized task context subject to access and privacy policy.
3. Each expert submits a versioned candidate package: solution artifacts, declared assumptions, evidence manifest, validation instructions, limitations and a structured self-evaluation.
4. Candidate packages are frozen at submission. New work produces a new revision and preserves the prior version.
5. P0/P1 candidates run the predeclared application validator against their own isolated candidate branch/environment.
6. P2/P3 candidates enter conflict-checked independent review, comparison and adjudication.
7. Arena selects the outcome according to the prespecified proof policy. Popularity, speed or number of votes alone cannot win the round.
8. Payment is bound to the accepted candidate, attempt, evidence decision and unique payment operation ID.

### Evaluator path

An expert can be assigned to review another expert's candidate. Before assignment, check task capability, qualification, conflicts, relationships, prior collaboration, financial interest, attempt participation, identity of the author if blinded, and allowed reviewer capacity. The evaluation contract states which identities and artifacts may be revealed.

The reviewer must score each required dimension, explain each nontrivial score, attach evidence references, disclose uncertainty, identify safety/professional concerns, and choose accept, reject, revise, abstain or escalate. A reviewer may not approve their own candidate or a candidate where a declared or detected conflict exists.

## 2. Expert self-evaluation must work well

Self-evaluation is a required, ergonomic first-class step for relevant tasks—not a dead-end text box. The workbench should let the author:

- Translate every acceptance criterion into a testable claim.
- Mark each claim met, partially met, not met, or not verifiable.
- Attach artifact/evidence references to each claim.
- State assumptions, limitations, known failure modes and residual risks.
- Provide confidence per criterion with a short rationale.
- Run available validators and display the exact validator version/result.
- Preview what independent reviewers and the requester will receive.
- Submit the candidate and self-evaluation as one versioned record.
- Respond to reviewer questions or produce a revision without overwriting history.
- Appeal a decision with new evidence or a specific procedural challenge.

The interface must state that self-evaluation is the author's claim, not an independent verification. It is useful for transparency, matching, review routing and helping evaluators understand evidence; it cannot count toward the independent review quorum, establish certification or trigger payment by itself.

## 3. Blind and fair comparison

Where feasible, use blinded candidate identifiers and normalize presentation so evaluators are not influenced by names, reputation, price or popularity before scoring. Do not strip technical evidence necessary to judge correctness. Where the domain requires verified identity or licensure, concealment must not defeat safety checks; the reviewer may see verified credentials while candidate authorship stays masked where feasible.

Use a common rubric frozen before the round. Criteria should include correctness, completeness, constraint satisfaction, evidence quality, reproducibility, risk, clarity/maintainability where relevant, and task-specific dimensions. Weightings and any hard-stop criteria are versioned. The scoring engine must record rubric version and individual dimension decisions, not only a final mean.

For P0/P1 work, validator results are the primary correctness evidence; human review focuses on causal attribution, quality, security, maintainability and any acceptance dimensions the validator does not establish. For P2/P3 work, independent evaluation and adjudication carry the burden of proof.

## 4. Quorum and disagreements

Default review policy:

- P0/P1: automated validators plus one independent qualified review for materiality/causal concerns; risk policy may require more.
- P2: at least two independent reviewers. High-impact or disputed tasks default to three.
- P3 and regulated/safety-critical work: task-specific professional and field-evidence quorum defined before assignment; do not use the generic minimum as a substitute.

Require adjudication when scores cross a configured disagreement threshold, reviewers conflict, any reviewer invokes a hard-stop safety concern, a required dimension is unscored, evidence provenance is disputed, or independent validators disagree. The adjudicator must be independent of the candidate and prior decisions where feasible.

If reviewer quorum is not reached, the system must request a replacement or escalate. Never infer approval from reviewer timeout. Reviewer payments are separate from candidate-expert payout and follow a separately versioned policy.

## 5. Rating system

Keep distinct measures for:

- Candidate task outcome, based on proof class and rubric.
- Expert delivery reliability: timeliness, communication, scope adherence and revision handling.
- Evidence quality and claim calibration.
- Reviewer quality: agreement with adjudicated outcomes, evidence-grounded rationale and calibration over time.
- Requester experience, visible with context and fraud protections.
- Safety, conflict and professional-conduct flags.

Ratings are scoped by domain, task type and evidence class. Do not use a single global star average as the main routing or certification authority. Weight ratings by evidence quality and calibration; discount suspected collusion, retaliation, review rings, duplicate accounts and brigading. Give experts a documented dispute/appeal channel and prevent a requester from silently rewriting verified outcomes.

Self-ratings are retained as calibration data but are never conflated with peer ratings. High confidence paired with repeatedly failing evidence may inform calibration and routing, not a punitive correctness rule without context. Sparse history is shown as insufficient evidence, not a low score.

## 6. Round and candidate states

Round:
DRAFT → FROZEN → OPEN_FOR_ATTEMPTS → SUBMISSIONS_CLOSED → VALIDATING → REVIEWING → ADJUDICATING (conditional) → DECIDED → PAYMENT_PENDING (when applicable) → CLOSED.

Candidate:
DRAFT → SUBMITTED → VALIDATING → VALIDATOR_PASSED / VALIDATOR_FAILED / VALIDATOR_INCONCLUSIVE → INDEPENDENT_REVIEW → REVISION_REQUESTED (optional) → ACCEPTED / REJECTED / WITHDRAWN.

Review:
ASSIGNED → ACCEPTED_BY_REVIEWER → IN_PROGRESS → SUBMITTED → (optional) CHALLENGED → FINALIZED.

Every transition needs an authorized actor, timestamp, reason/evidence references and idempotency. Revisions create new immutable candidate versions. State machines may be refined only by an ACR and contract tests.

## 7. Gaming, confidentiality, and safety controls

- Review assignment detects self-review, shared identity, conflicts, collusion signals and suspicious voting patterns.
- Preserve reviewer independence and do not expose private evaluator notes to an author if policy marks them confidential.
- Rate limits and unique reviewer/evaluator identities prevent review stuffing.
- No crowd vote can override failed hard acceptance criteria.
- Candidate code/artifacts execute only in isolated environments with least privilege, bounded egress and short-lived scoped credentials.
- Competition artifacts are not automatically public or reusable; data rights, customer confidentiality and explicit publication consent still apply.
- A candidate can be accepted for a narrow task and still be ineligible for general reuse or certification.
- Never reward intentionally destructive, unsafe or unauthorized solutions, even if a simplistic validator passes.
- Provide evidence-backed explanations for selection, rejection and payment status, subject to confidentiality and safety policy.

## 8. Acceptance tests

- An author can complete and submit a self-evaluation with criterion-level evidence and limitations.
- The author's self-evaluation does not count as a reviewer vote or independent quorum member.
- At least two eligible candidates can submit isolated, attributable solutions in one round.
- Identical predeclared application validation is applied to eligible candidates.
- An ineligible or conflicted evaluator cannot review the candidate.
- Reviewer timeout triggers replacement/escalation, never implicit approval.
- Material disagreement produces an adjudication record.
- P0 winning candidate payment is tied to verified validator evidence, not votes.
- P2 winner cannot be selected or paid based only on author claims, star ratings or majority popularity.
- Revisions preserve prior candidate versions and evidence.
- Tenant data, secret values and confidential reviewer notes are not disclosed across unauthorized boundaries.
- A round's winner, criteria, proof policy, evidence decision and payment operation are traceable through stable IDs.
