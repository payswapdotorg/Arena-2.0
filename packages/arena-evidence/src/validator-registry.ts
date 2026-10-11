import { z } from "zod";
import { validatorDescriptorSchema } from "@arena/contracts";

/** 冻结 descriptor 类型（从 schema 推导；公开面未导出该类型，本地派生 ——
 * 单一事实源仍是 CF1.0 的 validatorDescriptorSchema 本体）。 */
export type ValidatorDescriptor = z.infer<typeof validatorDescriptorSchema>;

/**
 * AR2-007 — validator 注册表 + 有界调用接口（PVP1.0 §5；AR2-004 缝隙对齐）。
 *
 * - 注册表持有 ValidatorDescriptor（冻结 CF1.0 schema：validator_id+version、
 *   kind、allowed_commands、timeout_seconds、resource_limits、evidence_policy）。
 *   校验器标识 = (validator_id, validator_version) 精确匹配 —— 证明记录必须
 *   能钉死「哪个版本的哪个校验器」产生了该输出（可复现性披露）。
 * - 有界调用 = timeout + 允许命令面：本包提供端口形状与确定性参考执行器。
 *   真实 OS 级隔离执行属于 capsule 域（AR2-004 CapsuleProvider port，
 *   UPSTREAM_RUNTIME_NOT_A_BOUNDARY_RULE）；本 WO 的执行器是内存中有界
 *   适配器（disclosed），生产接线将 command 执行替换为 capsule 调用而
 *   端口形状不变。
 * - 输出归一化：deterministic → 单次 verdict；statistical → 样本序列；
 *   rubric → 维度分。任何执行错误/超时 = 类型化 FAIL（绝不静默视为通过）。
 */

export type ValidatorVerdict =
  | { kind: "PASS" }
  | { kind: "FAIL"; reason: string }
  | { kind: "INCONCLUSIVE"; reason: string };

/** 归一化输出：按 validator kind 携带结构化结果。 */
export interface NormalizedValidatorOutput {
  validator_id: string;
  validator_version: string;
  kind: ValidatorDescriptor["kind"];
  verdict: ValidatorVerdict;
  /** 样本结果（statistical）：每次 repetition 一个布尔 + 备注。 */
  samples: ReadonlyArray<{ passed: boolean; note: string }>;
  /** 维度分（rubric）：0..1，附依据引用。 */
  dimensions: ReadonlyArray<{ dimension: string; score: number; basis: string }>;
  duration_ms: number;
  /** 超时/错误时的机器可读原因（typed fail 的细节）。 */
  failure: { code: "TIMEOUT" | "EXECUTION_ERROR" | "COMMAND_NOT_ALLOWED"; detail: string } | null;
}

export interface ValidatorRegistryCheck {
  ok: boolean;
  descriptor: ValidatorDescriptor | null;
  issues: ReadonlyArray<{ field: string; rule: string }>;
}

/** 注册表：descriptor 冻结 schema 先行；同 id+version 重复注册幂等。 */
export class ValidatorRegistry {
  private readonly byKey = new Map<string, ValidatorDescriptor>();

  register(descriptor: unknown): ValidatorRegistryCheck {
    const parsed = validatorDescriptorSchema.safeParse(descriptor);
    if (!parsed.success) {
      return {
        ok: false,
        descriptor: null,
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
          rule: `${issue.code}${issue.message ? ` — ${issue.message}` : ""}`,
        })),
      };
    }
    const key = keyOf(parsed.data);
    const existing = this.byKey.get(key);
    if (existing !== undefined) {
      // 同键重复注册：幂等返回（描述符不可变；不相同则拒绝覆盖）。
      const identical = JSON.stringify(existing) === JSON.stringify(parsed.data);
      return identical
        ? { ok: true, descriptor: existing, issues: [] }
        : {
            ok: false,
            descriptor: null,
            issues: [
              {
                field: "validator_id/validator_version",
                rule: "re-registration with a different descriptor is forbidden (immutable registry)",
              },
            ],
          };
    }
    this.byKey.set(key, parsed.data);
    return { ok: true, descriptor: parsed.data, issues: [] };
  }

  resolve(validator_id: string, validator_version: string): ValidatorDescriptor | null {
    return this.byKey.get(`${validator_id}@${validator_version}`) ?? null;
  }

  descriptors(): readonly ValidatorDescriptor[] {
    return [...this.byKey.values()];
  }
}

/**
 * 有界校验器执行端口。实现必须：
 * - 只执行 descriptor.allowed_commands 内声明的命令（其余 COMMAND_NOT_ALLOWED）；
 * - 强制 descriptor.timeout_seconds（超时 = TIMEOUT typed fail）；
 * - 任何抛错 = EXECUTION_ERROR typed fail（绝不静默 PASS）。
 */
export interface BoundedValidatorInvocation {
  readonly descriptor: ValidatorDescriptor;
  execute(
    command: string,
    input: unknown,
    timeoutMs?: number,
  ): Promise<{ ok: boolean; note: string }>;
}

/**
 * 确定性参考执行器（内存中有界适配器，DISCLOSED 非生产）：
 * 命令直接映射注入的行为函数；真实 capsule 执行接线属于 AR2-004+ 组合。
 * timeout 用真实计时器强制（不是模拟）。
 */
export interface DeterministicValidatorBehavior {
  (input: unknown): { ok: boolean; note: string } | Promise<{ ok: boolean; note: string }>;
}

export class BoundedValidatorRunner implements BoundedValidatorInvocation {
  readonly descriptor: ValidatorDescriptor;
  private readonly behavior: DeterministicValidatorBehavior;

  constructor(descriptor: ValidatorDescriptor, behavior: DeterministicValidatorBehavior) {
    this.descriptor = descriptor;
    this.behavior = behavior;
  }

  async execute(
    command: string,
    input: unknown,
    timeoutMs?: number,
  ): Promise<{ ok: boolean; note: string }> {
    if (!this.descriptor.allowed_commands.includes(command)) {
      return { ok: false, note: `COMMAND_NOT_ALLOWED: ${command}` };
    }
    const limitMs = timeoutMs ?? this.descriptor.timeout_seconds * 1000;
    // async IIFE：同步 throw 也被归一化为 rejected promise（类型化 EXECUTION_ERROR）。
    return withTimeout((async () => this.behavior(input))(), limitMs);
  }
}

/** 归一化单次运行为 NormalizedValidatorOutput（deterministic / statistical /
 * rubric / field_observer 共用骨架，未提供的部分为空数组）。 */
export function normalizeRun(
  descriptor: ValidatorDescriptor,
  outcome: { ok: boolean; note: string },
  durationMs: number,
): NormalizedValidatorOutput {
  const verdict: ValidatorVerdict = outcome.ok
    ? { kind: "PASS" }
    : { kind: "FAIL", reason: outcome.note };
  return {
    validator_id: descriptor.validator_id,
    validator_version: descriptor.validator_version,
    kind: descriptor.kind,
    verdict,
    samples: descriptor.kind === "statistical" ? [{ passed: outcome.ok, note: outcome.note }] : [],
    dimensions:
      descriptor.kind === "rubric" && outcome.ok
        ? [{ dimension: "aggregate", score: 1, basis: outcome.note }]
        : [],
    duration_ms: durationMs,
    failure: null,
  };
}

/** 超时/错误运行 → 类型化失败输出（绝不静默通过）。 */
export function normalizeFailure(
  descriptor: ValidatorDescriptor,
  failure: NonNullable<NormalizedValidatorOutput["failure"]>,
  durationMs: number,
): NormalizedValidatorOutput {
  const reason = `${failure.code}: ${failure.detail}`;
  return {
    validator_id: descriptor.validator_id,
    validator_version: descriptor.validator_version,
    kind: descriptor.kind,
    verdict: { kind: "FAIL", reason },
    samples: [],
    dimensions: [],
    duration_ms: durationMs,
    failure,
  };
}

function keyOf(descriptor: ValidatorDescriptor): string {
  return `${descriptor.validator_id}@${descriptor.validator_version}`;
}

function withTimeout(
  promise: Promise<{ ok: boolean; note: string }>,
  limitMs: number,
): Promise<{ ok: boolean; note: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ok: false, note: `TIMEOUT: exceeded ${limitMs}ms bounded invocation` });
    }, limitMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          note: `EXECUTION_ERROR: ${error instanceof Error ? error.message : String(error)}`,
        });
      });
  });
}
