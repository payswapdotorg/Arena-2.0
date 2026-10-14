import { accessSync, constants, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * AR2-019 / issue #64 (MAINT-002) — ambient-aware RLIMIT_NPROC ceiling.
 *
 * 缺陷背景（issue #64）：旧实现把 DEFAULT_MAX_PROCESSES=128 作为
 * `prlimit --nproc=128` 施加在 bwrap 父进程上。在共享宿主机上，内核级
 * （uid 全局）进程数可以远超容器内可见的 PID 数（TL 站：可见 ~36，内核
 * 计数 ~170-199），于是 bwrap 自身的 clone() 以 EAGAIN 失败——
 * "Creating new namespace failed: Resource temporarily unavailable"——
 * 沙箱完全不可用。
 *
 * 修复姿态（issue #64 方向 3，双机制）：
 *   1. nproc 上限改为「环境 uid 内核级进程数 + 预算裕量」并在
 *      [floor, hard ceiling] 内夹取（本模块的纯函数）；
 *   2. RLIMIT_NPROC 在用户命名空间切换之后由沙箱内的 prlimit 包装器
 *      施加（child-side），父侧 prlimit 前缀不再携带 --nproc，
 *      bwrap 自身的 clone 不再被环境计数卡死（见 execution-argv.ts）。
 *
 * 计入预算的「环境进程数」必须取内核级计数：在 uid 全局记账的内核
 * （README 记载的 5.15 之前）上，/proc 扫描只见本 pid namespace 的切片，
 * 会低估共享宿主机上的真实计数；因此 capability.ts 用经验校准
 * （prlimit --nproc=L -- bwrap 阶梯探测）测出内核级估计值，本模块
 * 只承载纯计算与 /proc 可见计数（如实记录为下界）。
 */

/** 进程预算裕量：环境计数之上额外授予的进程额度（默认预算）。
 * 与历史 DEFAULT_MAX_PROCESSES=128 一致——健康站点上工作负载的
 * 可用 fork 预算保持不变。 */
export const NPROC_MARGIN = 128;

/** 夹取下限：计算出的 ceiling 永不低于该「可用下限」
 * （环境计数不可读时的回退姿态也落在它上面）。 */
export const NPROC_CEILING_FLOOR = 128;

/** 夹取上限（硬上限常量）：ceiling 永不超过该值。 */
export const NPROC_HARD_CEILING = 4096;

/** 经验校准阶梯：对 `prlimit --nproc=L -- bwrap <最小沙箱> /bin/true`
 * 逐级探测，第一个成功级 = 内核级环境计数的保守估计（count < L）。
 * 与策略探测使用完全相同的 bwrap argv，失败增量可归因于 nproc
 * （issue #64 的失败签名）。 */
export const NPROC_PROBE_LADDER = [64, 128, 256, 512, 1024, 2048, 4096] as const;

/** 环境报告里记录的 nproc ceiling 计算结果（默认裕量、探测时刻）。 */
export interface NprocCeilingComputed {
  /** 内核级环境进程计数估计（校准值；null = 不可读/超阶梯）。 */
  ambient_count: number | null;
  /** 默认裕量常量（探测时刻计算所用预算）。 */
  margin: number;
  floor: number;
  hard_ceiling: number;
  /** clamp(ambient + margin, floor, hard_ceiling)；ambient 为 null 时
   * 按 0 参与求和（回退姿态，如实记录 ambient_count=null）。 */
  computed_ceiling: number;
}

/** 每次执行的 nproc 姿态证据：child-side 应用是否成立、生效上限、
 * 环境计数与常量——审计记录，随 SandboxIsolationEvidence 返回。 */
export interface NprocCeilingPosture {
  /** RLIMIT_NPROC 是否真的经沙箱内包装器施加（false = 未施加并记录原因）。 */
  applied: boolean;
  /** 生效的 child-side RLIMIT_NPROC（未施加时为 null）。 */
  effective_ceiling: number | null;
  ambient_uid_process_count: number | null;
  visible_uid_process_count: number | null;
  /** 本次执行使用的进程预算（profile.max_processes 或默认裕量）。 */
  process_budget: number;
  margin: number;
  floor: number;
  hard_ceiling: number;
  /** 人类可审计的姿态说明（未施加时含原因）。 */
  detail: string;
}

/**
 * 纯函数：环境计数 → 夹取后的 nproc ceiling。
 *
 * ceiling = clamp(ambient + budget, NPROC_CEILING_FLOOR, NPROC_HARD_CEILING)
 *
 * - ambient 为 null（不可读）时按 0 求和（下限兜底），调用方负责把
 *   「环境计数不可读」如实记入报告/证据；
 * - budget 必须是正的有限整数——非法值直接抛错（fail-closed，
 *   绝不悄悄夹取成看似合法的上限）。
 */
export function computeNprocCeiling(
  ambientCount: number | null,
  requestedBudget: number = NPROC_MARGIN,
): NprocCeilingComputed {
  if (!Number.isSafeInteger(requestedBudget) || requestedBudget < 1) {
    throw new Error(`invalid nproc process budget: ${String(requestedBudget)}`);
  }
  const ambientBase = ambientCount ?? 0;
  const sum = ambientBase + requestedBudget;
  const computed = Math.min(NPROC_HARD_CEILING, Math.max(NPROC_CEILING_FLOOR, sum));
  return {
    ambient_count: ambientCount,
    margin: NPROC_MARGIN,
    floor: NPROC_CEILING_FLOOR,
    hard_ceiling: NPROC_HARD_CEILING,
    computed_ceiling: computed,
  };
}

/**
 * /proc 扫描：本 pid namespace 内可见的、属于指定 uid 的进程数。
 *
 * 只作如实下界记录——共享宿主机上内核级 uid 计数可以远高于该值
 * （issue #64 的核心证据），真正的 ceiling 计算用 capability.ts 的
 * 经验校准值。返回 null = /proc 不可读（如实记录，绝不编造）。
 */
export function readVisibleUidProcessCount(
  uid?: number,
  procRoot = "/proc",
): number | null {
  let targetUid = uid;
  if (targetUid === undefined) {
    if (typeof process.getuid !== "function") {
      return null;
    }
    targetUid = process.getuid();
  }
  let entries: string[];
  try {
    entries = readdirSync(procRoot);
  } catch {
    return null;
  }
  let count = 0;
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    try {
      const status = readFileSync(join(procRoot, entry, "status"), "utf8");
      const uidLine = status.split("\n").find((line) => line.startsWith("Uid:"));
      if (uidLine === undefined) {
        continue;
      }
      const realUid = Number(uidLine.trim().split(/\s+/)[1]);
      if (realUid === targetUid) {
        count += 1;
      }
    } catch {
      // 单个进程状态不可读（已退出/权限）——跳过；计数保持下界语义。
      continue;
    }
  }
  return count;
}

/** 沙箱内 nproc 包装器的固定位置：宿主 /usr 只读绑定到沙箱 /usr，
 * 故沙箱内 /usr/bin/prlimit 与宿主同文件（merged-usr 假设与现有
 * rootfs 构造一致，见 execution-argv.ts 的 symlink 组）。 */
export const SANDBOX_NPROC_WRAPPER_PATH = "/usr/bin/prlimit";

/**
 * issue #64：解析沙箱内可用的 nproc 包装器。宿主 /usr 以只读绑定成为
 * 沙箱 /usr，因此宿主 <hostUsrPath>/bin/prlimit 可执行 ⇔ 沙箱内
 * /usr/bin/prlimit 可执行（同一文件）。不可用 → null：不施加 nproc
 * （与“prlimit 缺失则不施加 rlimit”的既有降级姿态一致），姿态证据
 * 如实记录原因，绝不伪造已施加。
 */
export function resolveNprocWrapper(
  hostUsrPath: string,
  ceiling: number,
): { sandboxPath: string; ceiling: number } | null {
  const hostCandidate = join(hostUsrPath, "bin", "prlimit");
  try {
    accessSync(hostCandidate, constants.X_OK);
  } catch {
    return null;
  }
  return { sandboxPath: SANDBOX_NPROC_WRAPPER_PATH, ceiling };
}

/** 构建每次执行的 nproc 姿态证据（进入 SandboxIsolationEvidence）。
 * 环境参数用结构化最小类型，避免与 capability.ts 的循环依赖。 */
export function buildNprocPosture(
  nprocWrapper: { sandboxPath: string; ceiling: number } | null,
  effectiveCeiling: number,
  environment: { ambient_uid_process_count: number | null; visible_uid_process_count: number | null },
  processBudget: number,
): NprocCeilingPosture {
  const base = {
    ambient_uid_process_count: environment.ambient_uid_process_count,
    visible_uid_process_count: environment.visible_uid_process_count,
    process_budget: processBudget,
    margin: NPROC_MARGIN,
    floor: NPROC_CEILING_FLOOR,
    hard_ceiling: NPROC_HARD_CEILING,
  };
  if (nprocWrapper === null) {
    return {
      ...base,
      applied: false,
      effective_ceiling: null,
      detail:
        "RLIMIT_NPROC NOT applied: no prlimit wrapper visible inside the sandbox " +
        `(${SANDBOX_NPROC_WRAPPER_PATH} requires the host runtime tree to provide prlimit — ` +
        "other rlimits and wall clock remain enforced; issue #64 posture recorded honestly)",
    };
  }
  return {
    ...base,
    applied: true,
    effective_ceiling: effectiveCeiling,
    detail:
      `RLIMIT_NPROC=${effectiveCeiling} applied child-side via the in-sandbox prlimit wrapper ` +
      `(after the user-namespace transition); the parent-side prlimit prefix carries no ` +
      `--nproc (issue #64). ceiling = clamp(ambient ${base.ambient_uid_process_count ?? "unknown"} ` +
      `+ budget ${processBudget}, floor ${NPROC_CEILING_FLOOR}, hard ceiling ` +
      `${NPROC_HARD_CEILING})`,
  };
}
