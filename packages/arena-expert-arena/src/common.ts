import { z } from "zod";

/** 本包 schema 用的局部文本约束（contracts 的同名内部件不导出 ——
 * 这里不镜像冻结语义，只定义本地结构边界）。 */
export const nonEmptyShort = z.string().min(1).max(120);
export const nonEmptyMedium = z.string().min(1).max(2000);
