import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { EvidenceEnvelopeView } from "./drive.js";

/**
 * AR2-021 render host — evidence-detail dialog.
 *
 * role="dialog" + aria-modal + aria-labelledby; focus moves in on open; Tab
 * cycles within the dialog (focus trap); Escape closes; focus returns to the
 * trigger on close/unmount (restore ref captured at open time).
 */
export function EvidenceDetailDialog(props: {
  envelope: EvidenceEnvelopeView;
  onClose: () => void;
}): ReactNode {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        props.onClose();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const dialog = dialogRef.current;
      if (dialog === null) {
        return;
      }
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("disabled"));
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (first === undefined || last === undefined) {
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      restoreRef.current?.focus();
    };
  }, [props]);

  const envelope = props.envelope;
  return (
    <div
      className="arena-dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          props.onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="arena-evidence-dialog-title"
        className="arena-dialog"
        data-evidence={envelope.evidence_id}
      >
        <h3 id="arena-evidence-dialog-title">Evidence details — {envelope.evidence_id}</h3>
        <dl className="arena-evidence-detail">
          <dt>Evidence id</dt>
          <dd>
            <code>{envelope.evidence_id}</code>
          </dd>
          <dt>Redaction class</dt>
          <dd>{envelope.redaction_class}</dd>
          <dt>Media type</dt>
          <dd>{envelope.object.media_type}</dd>
          <dt>Size</dt>
          <dd>{envelope.object.size_bytes} bytes</dd>
          <dt>Storage reference</dt>
          <dd>
            <code>{envelope.object.storage_ref}</code>
          </dd>
          <dt>Issuer</dt>
          <dd>
            {envelope.provenance.issuer_tier} ({envelope.provenance.issuer_id})
          </dd>
          <dt>Signature algorithm</dt>
          <dd>{envelope.provenance.signature_algorithm}</dd>
          <dt>Issued at</dt>
          <dd>{envelope.provenance.issued_at}</dd>
          <dt>Replay protection</dt>
          <dd>{envelope.provenance.replay_protection}</dd>
          <dt>Attempt binding</dt>
          <dd>
            <code>{envelope.binding.attempt_id}</code>
          </dd>
          <dt>Validator</dt>
          <dd>
            <code>
              {envelope.binding.validator_id}@{envelope.binding.validator_version}
            </code>
          </dd>
        </dl>
        <button ref={closeRef} type="button" className="arena-dialog-close" onClick={props.onClose}>
          Close evidence details
        </button>
      </div>
    </div>
  );
}
