/**
 * UIA-003 — 开发者门户：ACQ1.0 提供方注册表词表（真实 schema 运行时枚举）。
 *
 * 冻结纪律（与 contractReference 同法）：
 * - 路由模式 / pinned 引用 / 首选路由 / 描述符字段全部从
 *   **@arena/acquisition 公开契约的真实 zod schema** 运行时枚举
 *   （.options / .shape keys —— 绝不手抄第二份词表）；
 * - 语义规则常量（FALLBACK_CONSTRAINTS_RULE / ACQUISITION_REQUEST_TENANT_RULE）
 *   从公开契约逐字流转；
 * - 只读呈现：本面板不注册提供方、不路由请求（route-command 属 ACQ 域）。
 */
import {
  acquisitionRouteModeSchema,
  ACQUISITION_REQUEST_TENANT_RULE,
  capabilityOfferSchema,
  capabilityProviderDescriptorSchema,
  FALLBACK_CONSTRAINTS_RULE,
  pinnedProviderReferenceSchema,
  preferredRouteSchema,
  providerKindSchema,
  providerStatusSchema,
  sourceRightsPostureSchema,
} from "@arena/acquisition";

/** ACQ1.0 路由模式（真实枚举 options —— 逐字）。 */
export const ACQUISITION_ROUTE_MODES: readonly string[] = acquisitionRouteModeSchema.options;

/** pinned 引用字段（真实 schema shape keys —— 逐字）。 */
export const PINNED_PROVIDER_REFERENCE_FIELDS: readonly string[] = Object.keys(
  pinnedProviderReferenceSchema.shape,
);

/** 首选路由字段（真实 schema shape keys —— 逐字）。 */
export const PREFERRED_ROUTE_FIELDS: readonly string[] = Object.keys(preferredRouteSchema.shape);

/** 提供方注册描述符字段（真实 schema shape keys —— 逐字）。 */
export const PROVIDER_DESCRIPTOR_FIELDS: readonly string[] = Object.keys(
  capabilityProviderDescriptorSchema.shape,
);

/** 提供方能力声明字段（真实 schema shape keys —— 逐字）。 */
export const CAPABILITY_OFFER_FIELDS: readonly string[] = Object.keys(capabilityOfferSchema.shape);

/** 提供方种类（真实枚举 options —— 逐字）。 */
export const PROVIDER_KINDS: readonly string[] = providerKindSchema.options;

/** 提供方状态（真实枚举 options —— 逐字；只有 ACTIVE 可被路由）。 */
export const PROVIDER_STATUSES: readonly string[] = providerStatusSchema.options;

/** 来源权利姿态（真实枚举 options —— 逐字；UNKNOWN 一律 fail-closed）。 */
export const SOURCE_RIGHTS_POSTURES: readonly string[] = sourceRightsPostureSchema.options;

/** 提供方注册表面板视图模型（全部来自真实 schema 枚举）。 */
export interface ProviderRegistryViewModel {
  routeModes: readonly string[];
  pinnedReferenceFields: readonly string[];
  preferredRouteFields: readonly string[];
  descriptorFields: readonly string[];
  capabilityOfferFields: readonly string[];
  kinds: readonly string[];
  statuses: readonly string[];
  rightsPostures: readonly string[];
  fallbackRule: string;
  tenantRule: string;
}

export function providerRegistryViewModel(): ProviderRegistryViewModel {
  return {
    routeModes: ACQUISITION_ROUTE_MODES,
    pinnedReferenceFields: PINNED_PROVIDER_REFERENCE_FIELDS,
    preferredRouteFields: PREFERRED_ROUTE_FIELDS,
    descriptorFields: PROVIDER_DESCRIPTOR_FIELDS,
    capabilityOfferFields: CAPABILITY_OFFER_FIELDS,
    kinds: PROVIDER_KINDS,
    statuses: PROVIDER_STATUSES,
    rightsPostures: SOURCE_RIGHTS_POSTURES,
    fallbackRule: FALLBACK_CONSTRAINTS_RULE,
    tenantRule: ACQUISITION_REQUEST_TENANT_RULE,
  };
}
