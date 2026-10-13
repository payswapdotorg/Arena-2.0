/**
 * arena-isolation 模块清单：AR2-019 的 OS 级隔离运行时。
 * 在 AR2-004 capsule 缝隙后面实现 CapsuleProviderPort：unprivileged user +
 * mount + PID + IPC + UTS + 空 network namespace（bubblewrap）、seccomp
 * 黑名单（SIGSYS kill）、tmpfs-only scratch、rlimit 上限与父侧强制的
 * wall-clock；能力探测与一致性/对抗性证据记录是可检视的运行时产物。
 * 依赖声明与 architecture-policy.yaml 保持一致（TL 在集成站登记）；
 * 对外只暴露 contract.ts。
 */
export const arenaIsolationModule = {
  id: "arena-isolation",
  requires: ["arena-contracts", "arena-capsule"],
  provides: [
    "capsule-isolation-runtime-linux-namespace",
    "isolation-capability-probes",
    "isolation-seccomp-denylist",
    "isolation-conformance-evidence",
    "capsule-provider-port-implementation-bwrap",
  ],
  publicEntrypoints: ["contract.ts"],
} as const;
