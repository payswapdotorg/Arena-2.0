/**
 * AR2-019 — hand-rolled seccomp(2) BPF denylist builder.
 *
 * bwrap applies the filter via `--seccomp <fd>` INSIDE the sandbox (its own
 * setup completes first), so the filter only constrains the untrusted child.
 * Blocked syscalls return SECCOMP_RET_KILL_PROCESS: the kernel terminates the
 * offender with SIGSYS (documented, observed as exit status 159 = 128+31 in
 * the battery). Architecture mismatch (e.g. a 32-bit binary on x86_64) fails
 * closed to KILL_PROCESS because the number table below is arch-specific.
 *
 * The BPF program is emitted as a raw `struct sock_filter[]` array — the exact
 * format bubblewrap reads from the fd (`len % 8 == 0`, no header; verified
 * against bubblewrap 0.12.0 `seccomp_program_new`). No libseccomp dependency.
 */

/** BPF opcodes used by the filter (linux/filter.h). */
const BPF_LD_W_ABS = 0x20;
const BPF_JEQ_K = 0x15;
const BPF_RET_K = 0x06;

/** seccomp action constants (linux/seccomp.h). */
const SECCOMP_RET_KILL_PROCESS = 0x80000000;
const SECCOMP_RET_ALLOW = 0x7fff0000;

/** seccomp_data word offsets: nr @0, arch @4 (uapi/linux/seccomp.h). */
const SECCOMP_DATA_NR_OFFSET = 0;
const SECCOMP_DATA_ARCH_OFFSET = 4;

/** AUDIT_ARCH_* values (uapi/linux/audit.h). */
const AUDIT_ARCH_X86_64 = 0xc000003e;
const AUDIT_ARCH_AARCH64 = 0xc00000b7;

/** Sandboxed execution arch key (Node process.arch vocabulary). */
export type SandboxArch = "x64" | "arm64";

/** Class of syscalls denied inside every capsule: kernel keyring, module
 * loading, eBPF, kexec and perf — none are needed by acquisition work and
 * all are classic container-escape primitives. */
export const BLOCKED_SYSCALL_CLASSES = [
  "keyctl",
  "add_key",
  "request_key",
  "init_module",
  "finit_module",
  "delete_module",
  "bpf",
  "kexec_load",
  "kexec_file_load",
  "perf_event_open",
] as const;
export type BlockedSyscall = (typeof BLOCKED_SYSCALL_CLASSES)[number];

/** Arch-specific syscall numbers (linux asm tables; see SUPPLY-CHAIN.md). */
export const SYSCALL_NUMBERS: Record<
  BlockedSyscall,
  { x64: number; arm64: number }
> = {
  keyctl: { x64: 250, arm64: 219 },
  add_key: { x64: 248, arm64: 217 },
  request_key: { x64: 249, arm64: 218 },
  init_module: { x64: 175, arm64: 105 },
  finit_module: { x64: 313, arm64: 273 },
  delete_module: { x64: 176, arm64: 106 },
  bpf: { x64: 321, arm64: 280 },
  kexec_load: { x64: 246, arm64: 104 },
  kexec_file_load: { x64: 320, arm64: 294 },
  perf_event_open: { x64: 298, arm64: 241 },
};

function auditArchFor(arch: SandboxArch): number {
  return arch === "x64" ? AUDIT_ARCH_X86_64 : AUDIT_ARCH_AARCH64;
}

/** One BPF instruction packed as `struct sock_filter` (8 bytes, LE). */
function insn(code: number, jt: number, jf: number, k: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeUInt16LE(code, 0);
  buf.writeUInt8(jt, 2);
  buf.writeUInt8(jf, 3);
  buf.writeUInt32LE(k, 4);
  return buf;
}

/** Build the denylist filter for the given arch (raw sock_filter bytes). */
export function buildSeccompDenylistFilter(arch: SandboxArch): Buffer {
  const parts: Buffer[] = [
    // A = arch; if it is not the expected one → KILL_PROCESS (fail closed).
    insn(BPF_LD_W_ABS, 0, 0, SECCOMP_DATA_ARCH_OFFSET),
    insn(BPF_JEQ_K, 1, 0, auditArchFor(arch)),
    insn(BPF_RET_K, 0, 0, SECCOMP_RET_KILL_PROCESS),
    // A = syscall nr.
    insn(BPF_LD_W_ABS, 0, 0, SECCOMP_DATA_NR_OFFSET),
  ];
  for (const name of BLOCKED_SYSCALL_CLASSES) {
    const nr = SYSCALL_NUMBERS[name][arch];
    // match → fall through to KILL; miss → skip the KILL.
    parts.push(insn(BPF_JEQ_K, 0, 1, nr));
    parts.push(inss(BPF_RET_K, SECCOMP_RET_KILL_PROCESS));
  }
  parts.push(inss(BPF_RET_K, SECCOMP_RET_ALLOW));
  return Buffer.concat(parts);
}

function inss(code: number, k: number): Buffer {
  return insn(code, 0, 0, k);
}

/** Resolve the sandbox arch for the current process; null = unsupported
 * (seccomp denylist then honestly reports NOT_SUPPORTED). */
export function currentSandboxArch(): SandboxArch | null {
  if (process.arch === "x64") {
    return "x64";
  }
  if (process.arch === "arm64") {
    return "arm64";
  }
  return null;
}
