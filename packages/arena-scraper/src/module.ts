/**
 * arena-scraper 模块清单：AR2-017 Scraper Factory、crawler runtime 与外部
 * API connector 适配器（issue #33；spec/capability-acquisition §4/§5 + ACR-0002）。
 * 依赖声明与 architecture-policy.yaml 的依赖纪律一致（TL 负责 root 接线）；
 * 对外只暴露 contract.ts。
 */
export const arenaScraperModule = {
  id: "arena-scraper",
  requires: ["arena-contracts", "arena-acquisition", "arena-capsule"],
  provides: [
    "scraper-factory-lifecycle",
    "scraper-contracts",
    "crawler-runtime",
    "egress-guard",
    "source-policy",
    "quarantine-layer",
    "dataset-assembly",
    "external-api-connector-port",
    "apify-adapter",
  ],
  publicEntrypoints: ["contract.ts"],
} as const;
