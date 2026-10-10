export {
  checkCapsuleManifest,
  requireValidCapsuleManifest,
  CapsuleManifestRejected,
  type CapsuleManifestCheck,
  type ManifestIssue,
} from "./manifest-validation.js";

export {
  CAPSULE_SYNTHETIC_PROVIDER_DISCLOSURE,
  type CapsuleRuntimeState,
  type CapsuleRef,
  type CapsuleSnapshot,
  type ProvisionOutcome,
  type HeartbeatOutcome,
  type ArtifactTransferRequest,
  type TransferOutcome,
  type TeardownOutcome,
  type CapsuleProviderPort,
} from "./provider-port.js";

export {
  checkCapsuleBinding,
  bindingOfManifest,
  CapsuleBindingRegistry,
  type CapsuleBinding,
  type BindingCheck,
} from "./tenant-binding.js";

export { SyntheticLocalProvider, type SyntheticProviderOptions } from "./synthetic-provider.js";

export {
  PRODUCTION_ENABLED,
  SYNTHETIC_PROVIDER_IDENTITY,
  type CapsuleProviderIdentity,
  type CommandExecutionRequest,
  type ExecuteOutcome,
} from "./execution.js";

export {
  CAPSULE_LIFECYCLE_TRANSITIONS,
  capsuleLifecycleAllows,
  capsuleLifecycleIsTerminal,
} from "./lifecycle.js";

export {
  redactCredential,
  ScopedCredentialLedger,
  type ScopedCredentialSpec,
  type IssuedCredential,
  type IssuedSecret,
  type CredentialIssueOutcome,
  type CredentialCheck,
} from "./credentials.js";
