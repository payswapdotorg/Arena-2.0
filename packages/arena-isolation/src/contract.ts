export {
  // capability probes & environment report
  probeIsolationEnvironment,
  type IsolationEnvironmentReport,
  type IsolationCapability,
  type ProcfsStrategy,
  type BwrapToolReport,
  type ProbeOptions,
} from "./capability.js";

export {
  // seccomp denylist (hand-rolled BPF; no libseccomp dependency)
  buildSeccompDenylistFilter,
  BLOCKED_SYSCALL_CLASSES,
  SYSCALL_NUMBERS,
  currentSandboxArch,
  type SandboxArch,
  type BlockedSyscall,
} from "./seccomp.js";

export {
  // typed argv construction (argv arrays only — never shell strings)
  buildBwrapArgs,
  buildPrlimitArgs,
  RESERVED_SANDBOX_ROOTS,
  WRITABLE_SANDBOX_ROOTS,
  isAbsoluteSafePath,
  isReservedPath,
  isUnderWritableRoot,
  type SandboxSpec,
  type InputMount,
  type ResourceCeilings,
} from "./execution-argv.js";

export {
  // typed spawn layer + parent-side isolation evidence
  runIsolatedCommand,
  type SandboxRunInput,
  type SandboxRunResult,
  type SandboxIsolationEvidence,
  type BwrapInfoReport,
} from "./spawn-layer.js";

export {
  // provider (CapsuleProviderPort implementation)
  LinuxNamespaceIsolationProvider,
  ISOLATION_PROVIDER_IDENTITY,
  type IsolationProviderIdentity,
  type IsolationProviderOptions,
  type IsolationSessionEnvironment,
} from "./provider.js";

export {
  // execution surface
  runIsolationExecution,
  type IsolationExecutionRequest,
  type IsolationExecutionOutcome,
  type IsolationExecutionProfile,
} from "./isolation-execution.js";

export {
  // conformance evidence instrument
  buildConformanceEvidenceRecord,
  CONFORMANCE_PROBE_NAMES,
  type ConformanceEvidenceRecord,
  type ConformanceProbeResult,
  type ConformanceProbeStatus,
  type IsolationMode,
} from "./evidence.js";

export { arenaIsolationModule } from "./module.js";
