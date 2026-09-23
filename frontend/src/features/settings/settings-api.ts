import { apiRequest } from "@/shared/api/client";
import { createObjectDecoder, createValidatedDecoder, decodeBooleanResult, hasShape, isArrayOf, isBoolean, isNumber, isOneOf, isOptional, isRecordOf, isString } from "@/shared/api/decoder";
import type { SortOrder } from "@/shared/lib/table-sort";

export type SettingsConfigDTO = {
  server: { maxConcurrentRequests: number };
  providerBuild: { baseURL: string; fallbackBaseURL: string; clientVersion: string; clientIdentifier: string; tokenAuth: string; tokenAuthConfigured: boolean; userAgent: string; responseHeaderTimeout: string; streamIdleTimeout: string };
  providerWeb: {
    baseURL: string; quotaTimeout: string; chatTimeout: string; streamIdleTimeout: string; imageTimeout: string; videoTimeout: string;
    statsigMode: "manual" | "url"; statsigManualValue?: string; statsigManualConfigured: boolean; statsigSignerURL: string;
    clearanceMode: ClearanceMode; flareSolverrURL: string; clearanceTimeout: string; clearanceRefresh: string;
    mediaConcurrency: number; allowNSFW: boolean;
    recoveryBackoffBase: string; recoveryBackoffMax: string;
  };
  providerConsole: { baseURL: string; chatTimeout: string; streamIdleTimeout: string };
  batch: { importConcurrency: number; conversionConcurrency: number; syncConcurrency: number; refreshConcurrency: number; randomDelay: string };
  media: {
    maxImageBytes: number; maxTotalBytes: number; cleanupThresholdPercent: number;
    cleanupInterval: string;
  };
  frontend: { publicApiBaseURL: string };
  routing: {
    stickyTTL: string; cooldownBase: string; cooldownMax: string; capacityWait: string; maxAttempts: number; videoMaxAttempts: number; preferFreeBuild: boolean; markBuildChatDeniedAsReauth: boolean;
    accountIsolatedConnections: boolean;
    segmentedSelector: { enabled: boolean; minCandidates: number; windowSize: number };
  };
  audit: { bufferSize: number; batchSize: number; flushInterval: string; commitDelayMS: number; retentionDays?: number };
  clientKeyDefaults: { rpmLimit: number; maxConcurrent: number };
  accounts: {
    markBuildForbiddenReauth: boolean;
    buildForbiddenReauthCodes: string[];
    excludeBuildBotFlaggedFromScheduling: boolean;
    autoCleanReauthEnabled: boolean;
    autoCleanReauthInterval: string;
    autoCleanReauthMinAge: string;
    autoCleanIncludeDisabled: boolean;
  };
};

export type ClearanceMode = "manual" | "flaresolverr" | "on_demand";
export type EgressUsage = "production" | "probe";

export type EgressNodeDTO = {
	id: string; name: string; scope: EgressScope; enabled: boolean; usage: EgressUsage;
	proxyConfigured: boolean; proxyDisplay?: string; proxyFingerprint?: string; userAgent: string; cookieConfigured: boolean;
	accountBoundProxy: boolean; proxyPool: boolean; proxyProfileId?: string; proxyProfileName?: string;
	sourceId?: string; accountCapacity: number; assignedAccountCount: number;
	health: number; failureCount: number; cooldownUntil?: string; lastError?: string;
	probeStatus: "unknown" | "healthy" | "unhealthy"; lastProbedAt?: string; probeLatencyMs: number; exitIp?: string; probeError?: string;
	probeProvider?: "ipinfo" | "cloudflare";
	ipv4Probe: EgressIPProbeDTO; ipv6Probe: EgressIPProbeDTO;
};

export type EgressNodeInput = {
	name: string; scope: EgressScope; enabled: boolean; usage?: EgressUsage; proxyPool: boolean; proxyURL?: string;
	proxyProfileId?: string;
	accountCapacity: number; clearProxyURL?: boolean; userAgent: string; cloudflareCookies?: string; clearCookies?: boolean;
};

export type EgressProxyProfileDTO = {
	id: string; name: string; proxyDisplay?: string; proxyFingerprint?: string;
	boundNodeCount: number; createdAt: string; updatedAt: string;
};

export type EgressProxyProfileInput = { name: string; proxyURL?: string };
export type EgressProxyProfileListDTO = {
	items: EgressProxyProfileDTO[];
	page: number;
	pageSize: number;
	total: number;
};

export type EgressScope = "grok_build" | "grok_web" | "grok_console" | "grok_web_asset" | "grok_console_asset";
export type EgressFallbackMode = "none" | "direct" | "fixed";
export type EgressFallbackConfigDTO = { mode: EgressFallbackMode; nodeId?: string };
export type EgressNodeListDTO = {
  items: EgressNodeDTO[];
  page: number;
  pageSize: number;
  total: number;
  defaultUserAgents: Record<EgressScope, string>;
};
export type EgressSourceDTO = {
  id: string; name: string; scope: EgressScope; enabled: boolean; urlConfigured: boolean; proxyConfigured: boolean;
  refreshIntervalSeconds: number; defaultAccountCapacity: number;
  lastSyncedAt?: string; nextSyncAt?: string; lastSyncImported: number; lastSyncError?: string;
};
export type EgressSourceListDTO = {
  items: EgressSourceDTO[];
  page: number;
  pageSize: number;
  total: number;
};
export type EgressSourceInput = {
  name: string; scope: EgressScope; enabled: boolean; url?: string; clearUrl?: boolean;
  proxyURL?: string; clearProxyURL?: boolean;
  refreshIntervalSeconds: number; defaultAccountCapacity: number;
};
export type EgressOperationsConfigDTO = {
  probeProvider: "ipinfo" | "cloudflare"; probeIntervalSeconds: number; autoAssignEnabled: boolean; autoBalanceEnabled: boolean;
  assignmentIntervalSeconds: number; probeNodeLimit: number; fallbacks: Record<EgressScope, EgressFallbackConfigDTO>; updatedAt: string;
};
export type EgressImportResultDTO = { imported: number; skipped: number; replaced: number };
export type EgressIPProbeDTO = { status: "unknown" | "healthy" | "unhealthy"; testedAt?: string; latencyMs: number; exitIp?: string; error?: string };
export type EgressProbeResultDTO = { status: "unknown" | "healthy" | "unhealthy"; testedAt: string; latencyMs: number; exitIp?: string; error?: string; probeProvider?: "ipinfo" | "cloudflare"; ipv4: EgressIPProbeDTO; ipv6: EgressIPProbeDTO };
export type EgressProbeBatchResultDTO = { requested: number; healthy: number; unhealthy: number };
export type EgressRebalanceNodeStatsDTO = { total: number; healthy: number; unprobed: number; unhealthy: number; cooldown: number; disabled: number };
export type EgressRebalanceResultDTO = { assigned: number; rebalanced: number; unplaced: number; released: number; nodes: EgressRebalanceNodeStatsDTO };
export type EgressNodeAccountDTO = { id: number; provider: string; name: string; email?: string; enabled: boolean; authStatus: string; assignmentMode: string };
export type EgressNodeAccountsDTO = { accounts: EgressNodeAccountDTO[] };
export type EgressUnhealthyCleanupPreviewDTO = { nodes: number; boundAccounts: number; subscriptionManaged: number };

export type SettingsSnapshotDTO = {
  config: SettingsConfigDTO;
  recommendedProviderBuild: { clientVersion: string; userAgent: string };
  updatedAt: string;
  revision: string;
  restartRequired: string[];
};

const settingsConfigValidator = hasShape({
  server: hasShape({ maxConcurrentRequests: isNumber }),
  providerBuild: hasShape({ baseURL: isString, fallbackBaseURL: isString, clientVersion: isString, clientIdentifier: isString, tokenAuth: isString, tokenAuthConfigured: isBoolean, userAgent: isString, responseHeaderTimeout: isString, streamIdleTimeout: isString }),
  providerWeb: hasShape({
    baseURL: isString, quotaTimeout: isString, chatTimeout: isString, streamIdleTimeout: isOptional(isString), imageTimeout: isString, videoTimeout: isString,
    statsigMode: isOneOf("manual", "url"), statsigManualValue: isOptional(isString), statsigManualConfigured: isBoolean,
    statsigSignerURL: isString, clearanceMode: isOneOf("manual", "flaresolverr", "on_demand"), flareSolverrURL: isString,
    clearanceTimeout: isString, clearanceRefresh: isString, mediaConcurrency: isNumber, allowNSFW: isBoolean, recoveryBackoffBase: isString, recoveryBackoffMax: isString,
  }),
  providerConsole: hasShape({ baseURL: isString, chatTimeout: isString, streamIdleTimeout: isOptional(isString) }),
  batch: hasShape({ importConcurrency: isNumber, conversionConcurrency: isNumber, syncConcurrency: isNumber, refreshConcurrency: isNumber, randomDelay: isString }),
  media: hasShape({ maxImageBytes: isNumber, maxTotalBytes: isNumber, cleanupThresholdPercent: isNumber, cleanupInterval: isString }),
  frontend: hasShape({ publicApiBaseURL: isString }),
  routing: hasShape({
    stickyTTL: isString, cooldownBase: isString, cooldownMax: isString, capacityWait: isString, maxAttempts: isNumber, videoMaxAttempts: isNumber, preferFreeBuild: isBoolean, markBuildChatDeniedAsReauth: isBoolean,
    accountIsolatedConnections: isOptional(isBoolean),
    segmentedSelector: isOptional(hasShape({ enabled: isBoolean, minCandidates: isNumber, windowSize: isNumber })),
  }),
  audit: hasShape({
    bufferSize: isNumber, batchSize: isNumber, flushInterval: isString, commitDelayMS: isOptional(isNumber),
    retentionDays: isOptional(isNumber),
  }),
  clientKeyDefaults: hasShape({ rpmLimit: isNumber, maxConcurrent: isNumber }),
  // Older backends may omit accounts; withSettingsDefaults supplies a safe local default.
  accounts: isOptional(hasShape({
    markBuildForbiddenReauth: isOptional(isBoolean),
    buildForbiddenReauthCodes: isOptional(isArrayOf(isString)),
    excludeBuildBotFlaggedFromScheduling: isOptional(isBoolean),
    autoCleanReauthEnabled: isBoolean,
    autoCleanReauthInterval: isString,
    autoCleanReauthMinAge: isString,
    autoCleanIncludeDisabled: isBoolean,
  })),
});
const defaultAccountsConfig = (): SettingsConfigDTO["accounts"] => ({
  markBuildForbiddenReauth: false,
  buildForbiddenReauthCodes: ["permission-denied"],
  excludeBuildBotFlaggedFromScheduling: false,
  autoCleanReauthEnabled: false,
  autoCleanReauthInterval: "10m",
  autoCleanReauthMinAge: "1h",
  autoCleanIncludeDisabled: false,
});
function withSettingsDefaults(snapshot: SettingsSnapshotDTO): SettingsSnapshotDTO {
  const accounts = snapshot.config.accounts ?? defaultAccountsConfig();
  const segmentedSelector = snapshot.config.routing.segmentedSelector ?? { enabled: true, minCandidates: 3000, windowSize: 64 };
  return {
    ...snapshot,
    config: {
      ...snapshot.config,
      providerWeb: {
        ...snapshot.config.providerWeb,
        streamIdleTimeout: snapshot.config.providerWeb.streamIdleTimeout || "1m30s",
      },
      providerConsole: {
        ...snapshot.config.providerConsole,
        streamIdleTimeout: snapshot.config.providerConsole.streamIdleTimeout || "2m",
      },
      audit: {
        ...snapshot.config.audit,
        commitDelayMS: snapshot.config.audit.commitDelayMS ?? 5,
        retentionDays: snapshot.config.audit.retentionDays ?? 7,
      },
      routing: {
        ...snapshot.config.routing,
        markBuildChatDeniedAsReauth: snapshot.config.routing.markBuildChatDeniedAsReauth ?? false,
        accountIsolatedConnections: snapshot.config.routing.accountIsolatedConnections ?? false,
        segmentedSelector: {
          enabled: segmentedSelector.enabled ?? true,
          minCandidates: segmentedSelector.minCandidates || 3000,
          windowSize: segmentedSelector.windowSize || 64,
        },
      },
      accounts: {
        markBuildForbiddenReauth: accounts.markBuildForbiddenReauth ?? false,
        buildForbiddenReauthCodes: accounts.buildForbiddenReauthCodes ?? ["permission-denied"],
        excludeBuildBotFlaggedFromScheduling: accounts.excludeBuildBotFlaggedFromScheduling ?? false,
        autoCleanReauthEnabled: accounts.autoCleanReauthEnabled ?? false,
        autoCleanReauthInterval: accounts.autoCleanReauthInterval || "10m",
        autoCleanReauthMinAge: accounts.autoCleanReauthMinAge || "1h",
        autoCleanIncludeDisabled: accounts.autoCleanIncludeDisabled ?? false,
      },
    },
  };
}
const decodeSettingsSnapshotRaw = createObjectDecoder<SettingsSnapshotDTO>("settings", {
  config: settingsConfigValidator,
  recommendedProviderBuild: hasShape({ clientVersion: isString, userAgent: isString }),
  updatedAt: isString,
  revision: isString,
  restartRequired: isArrayOf(isString),
});
const decodeSettingsSnapshot = (value: unknown) => withSettingsDefaults(decodeSettingsSnapshotRaw(value));
const egressIPProbeValidator = hasShape({
  status: isOneOf("unknown", "healthy", "unhealthy"), testedAt: isOptional(isString), latencyMs: isNumber, exitIp: isOptional(isString), error: isOptional(isString),
});
type EgressNodeWireDTO = Omit<EgressNodeDTO, "ipv4Probe" | "ipv6Probe" | "usage"> & { ipv4Probe?: EgressIPProbeDTO; ipv6Probe?: EgressIPProbeDTO; usage?: EgressUsage };
type EgressSourceWireDTO = Omit<EgressSourceDTO, "proxyConfigured"> & { proxyConfigured?: boolean };
type EgressOperationsConfigWireDTO = Omit<EgressOperationsConfigDTO, "probeProvider" | "probeNodeLimit"> & {
  probeProvider?: "ipinfo" | "cloudflare";
  probeNodeLimit?: number;
};
type EgressProbeResultWireDTO = Omit<EgressProbeResultDTO, "ipv4" | "ipv6"> & { ipv4?: EgressIPProbeDTO; ipv6?: EgressIPProbeDTO };
const unknownEgressIPProbe = (): EgressIPProbeDTO => ({ status: "unknown", latencyMs: 0 });
const withEgressNodeProbeDefaults = (value: EgressNodeWireDTO): EgressNodeDTO => ({
  ...value,
  usage: value.usage ?? "production",
  ipv4Probe: value.ipv4Probe ?? unknownEgressIPProbe(),
  ipv6Probe: value.ipv6Probe ?? unknownEgressIPProbe(),
});
const withEgressSourceDefaults = (value: EgressSourceWireDTO): EgressSourceDTO => ({
  ...value,
  proxyConfigured: value.proxyConfigured ?? false,
});
const egressNodeValidator = hasShape({
  id: isString, name: isString, scope: isOneOf("grok_build", "grok_web", "grok_console", "grok_web_asset", "grok_console_asset"), enabled: isBoolean,
  usage: isOptional(isOneOf("production", "probe")),
  proxyConfigured: isBoolean, proxyDisplay: isOptional(isString), proxyFingerprint: isOptional(isString), userAgent: isString, cookieConfigured: isBoolean, accountBoundProxy: isBoolean, proxyPool: isBoolean, health: isNumber, failureCount: isNumber,
  sourceId: isOptional(isString), proxyProfileId: isOptional(isString), proxyProfileName: isOptional(isString), accountCapacity: isNumber, assignedAccountCount: isNumber,
  probeStatus: isOneOf("unknown", "healthy", "unhealthy"), lastProbedAt: isOptional(isString), probeLatencyMs: isNumber, exitIp: isOptional(isString), probeError: isOptional(isString), probeProvider: isOptional(isOneOf("ipinfo", "cloudflare")),
  ipv4Probe: isOptional(egressIPProbeValidator), ipv6Probe: isOptional(egressIPProbeValidator),
  cooldownUntil: isOptional(isString), lastError: isOptional(isString),
});
const decodeEgressNodeRaw = createObjectDecoder<EgressNodeWireDTO>("egress node", {
  id: isString, name: isString, scope: isOneOf("grok_build", "grok_web", "grok_console", "grok_web_asset", "grok_console_asset"), enabled: isBoolean,
  usage: isOptional(isOneOf("production", "probe")),
  proxyConfigured: isBoolean, proxyDisplay: isOptional(isString), proxyFingerprint: isOptional(isString), userAgent: isString, cookieConfigured: isBoolean, accountBoundProxy: isBoolean, proxyPool: isBoolean, health: isNumber, failureCount: isNumber,
  sourceId: isOptional(isString), proxyProfileId: isOptional(isString), proxyProfileName: isOptional(isString), accountCapacity: isNumber, assignedAccountCount: isNumber,
  probeStatus: isOneOf("unknown", "healthy", "unhealthy"), lastProbedAt: isOptional(isString), probeLatencyMs: isNumber, exitIp: isOptional(isString), probeError: isOptional(isString), probeProvider: isOptional(isOneOf("ipinfo", "cloudflare")),
  ipv4Probe: isOptional(egressIPProbeValidator), ipv6Probe: isOptional(egressIPProbeValidator),
  cooldownUntil: isOptional(isString), lastError: isOptional(isString),
});
const decodeEgressNode = (value: unknown) => withEgressNodeProbeDefaults(decodeEgressNodeRaw(value));
const decodeEgressProxyProfile = createObjectDecoder<EgressProxyProfileDTO>("egress proxy profile", {
  id: isString, name: isString, proxyDisplay: isOptional(isString), proxyFingerprint: isOptional(isString),
  boundNodeCount: isNumber, createdAt: isString, updatedAt: isString,
});
const decodeEgressProxyProfiles = createObjectDecoder<EgressProxyProfileListDTO>("egress proxy profiles", { items: isArrayOf(hasShape({
  id: isString, name: isString, proxyDisplay: isOptional(isString), proxyFingerprint: isOptional(isString),
  boundNodeCount: isNumber, createdAt: isString, updatedAt: isString,
})), page: isNumber, pageSize: isNumber, total: isNumber });
type EgressNodeListWireDTO = {
  items: EgressNodeWireDTO[];
  page?: number;
  pageSize?: number;
  total?: number;
  defaultUserAgents: Omit<Record<EgressScope, string>, "grok_console_asset"> & { grok_console_asset?: string };
};
const decodeEgressNodeListRaw = createObjectDecoder<EgressNodeListWireDTO>("egress node list", {
  items: isArrayOf(egressNodeValidator),
  page: isOptional(isNumber),
  pageSize: isOptional(isNumber),
  total: isOptional(isNumber),
  defaultUserAgents: hasShape({ grok_build: isString, grok_web: isString, grok_console: isString, grok_web_asset: isString, grok_console_asset: isOptional(isString) }),
});
const decodeEgressNodeList = (value: unknown): EgressNodeListDTO => {
  const decoded = decodeEgressNodeListRaw(value);
  return {
    ...decoded,
    items: decoded.items.map(withEgressNodeProbeDefaults),
    page: decoded.page ?? 1,
    pageSize: decoded.pageSize ?? Math.max(20, decoded.items.length),
    total: decoded.total ?? decoded.items.length,
    defaultUserAgents: {
      ...decoded.defaultUserAgents,
      grok_console_asset: decoded.defaultUserAgents.grok_console_asset ?? decoded.defaultUserAgents.grok_console,
    },
  };
};
const egressSourceValidator = hasShape({
  id: isString, name: isString, scope: isOneOf("grok_build", "grok_web", "grok_console", "grok_web_asset", "grok_console_asset"), enabled: isBoolean, urlConfigured: isBoolean,
  proxyConfigured: isOptional(isBoolean),
  refreshIntervalSeconds: isNumber, defaultAccountCapacity: isNumber, lastSyncedAt: isOptional(isString), nextSyncAt: isOptional(isString),
  lastSyncImported: isNumber, lastSyncError: isOptional(isString),
});
const decodeEgressSourceRaw = createObjectDecoder<EgressSourceWireDTO>("egress source", {
  id: isString, name: isString, scope: isOneOf("grok_build", "grok_web", "grok_console", "grok_web_asset", "grok_console_asset"), enabled: isBoolean, urlConfigured: isBoolean,
  proxyConfigured: isOptional(isBoolean),
  refreshIntervalSeconds: isNumber, defaultAccountCapacity: isNumber, lastSyncedAt: isOptional(isString), nextSyncAt: isOptional(isString),
  lastSyncImported: isNumber, lastSyncError: isOptional(isString),
});
const decodeEgressSource = (value: unknown) => withEgressSourceDefaults(decodeEgressSourceRaw(value));
type EgressSourceListWireDTO = {
  items: EgressSourceWireDTO[];
  page?: number;
  pageSize?: number;
  total?: number;
};
const decodeEgressSourceListRaw = createObjectDecoder<EgressSourceListWireDTO>("egress source list", {
  items: isArrayOf(egressSourceValidator), page: isOptional(isNumber), pageSize: isOptional(isNumber), total: isOptional(isNumber),
});
const decodeEgressSourceList = (value: unknown): EgressSourceListDTO => {
  const decoded = decodeEgressSourceListRaw(value);
  return {
    ...decoded,
    items: decoded.items.map(withEgressSourceDefaults),
    page: decoded.page ?? 1,
    pageSize: decoded.pageSize ?? Math.max(20, decoded.items.length),
    total: decoded.total ?? decoded.items.length,
  };
};
const decodeEgressImportResult = createObjectDecoder<EgressImportResultDTO>("egress import result", { imported: isNumber, skipped: isNumber, replaced: isOptional(isNumber) });
const withEgressImportResultDefaults = (value: { imported: number; skipped: number; replaced?: number }): EgressImportResultDTO => ({ imported: value.imported, skipped: value.skipped, replaced: value.replaced ?? 0 });
const decodeEgressProbeBatchResult = createObjectDecoder<EgressProbeBatchResultDTO>("egress probe result", { requested: isNumber, healthy: isNumber, unhealthy: isNumber });
const decodeEgressRebalanceResult = createObjectDecoder<EgressRebalanceResultDTO>("egress rebalance result", { assigned: isNumber, rebalanced: isNumber, unplaced: isNumber, released: isOptional(isNumber), nodes: isOptional(hasShape({ total: isNumber, healthy: isNumber, unprobed: isNumber, unhealthy: isNumber, cooldown: isNumber, disabled: isNumber })) });
const withEgressRebalanceDefaults = (value: { assigned: number; rebalanced: number; unplaced: number; released?: number; nodes?: EgressRebalanceNodeStatsDTO }): EgressRebalanceResultDTO => ({
  assigned: value.assigned, rebalanced: value.rebalanced, unplaced: value.unplaced, released: value.released ?? 0,
  nodes: value.nodes ?? { total: 0, healthy: 0, unprobed: 0, unhealthy: 0, cooldown: 0, disabled: 0 },
});
const egressFallbackConfigValidator = hasShape({ mode: isOneOf("none", "direct", "fixed"), nodeId: isOptional(isString) });
const decodeEgressOperationsConfigRaw = createObjectDecoder<EgressOperationsConfigWireDTO>("egress operations config", {
  probeProvider: isOptional(isOneOf("ipinfo", "cloudflare")), probeIntervalSeconds: isNumber, autoAssignEnabled: isBoolean, autoBalanceEnabled: isBoolean, assignmentIntervalSeconds: isNumber,
  probeNodeLimit: isOptional(isNumber),
  fallbacks: isRecordOf(egressFallbackConfigValidator), updatedAt: isString,
});
const decodeEgressOperationsConfig = (value: unknown): EgressOperationsConfigDTO => {
  const decoded = decodeEgressOperationsConfigRaw(value);
  return { ...decoded, probeProvider: decoded.probeProvider ?? "cloudflare", probeNodeLimit: decoded.probeNodeLimit ?? 100 };
};
const decodeEgressProbeResultRaw = createObjectDecoder<EgressProbeResultWireDTO>("egress probe", {
  status: isOneOf("unknown", "healthy", "unhealthy"), testedAt: isString, latencyMs: isNumber, exitIp: isOptional(isString), error: isOptional(isString), probeProvider: isOptional(isOneOf("ipinfo", "cloudflare")),
  ipv4: isOptional(egressIPProbeValidator), ipv6: isOptional(egressIPProbeValidator),
});
const decodeEgressProbeResult = (value: unknown): EgressProbeResultDTO => {
  const decoded = decodeEgressProbeResultRaw(value);
  return { ...decoded, ipv4: decoded.ipv4 ?? unknownEgressIPProbe(), ipv6: decoded.ipv6 ?? unknownEgressIPProbe() };
};

export function getSettings(): Promise<SettingsSnapshotDTO> {
  return apiRequest("/api/admin/v1/settings", {}, decodeSettingsSnapshot);
}

export function updateSettings(revision: string, config: SettingsConfigDTO): Promise<SettingsSnapshotDTO> {
  return apiRequest("/api/admin/v1/settings", { method: "PUT", body: { revision, config } }, decodeSettingsSnapshot);
}

type ListEgressNodesInput = {
  page?: number;
  pageSize?: number;
  search?: string;
  scope?: EgressScope | "";
  enabled?: string;
  usage?: EgressUsage | "";
  probe?: string;
  assignment?: string;
  sortBy?: string;
  sortOrder?: SortOrder;
};

export function listEgressNodes(input: ListEgressNodesInput = {}): Promise<EgressNodeListDTO> {
  const query = new URLSearchParams({ page: String(input.page ?? 1), pageSize: String(input.pageSize ?? 20) });
  if (input.search) query.set("search", input.search);
  if (input.scope) query.set("scope", input.scope);
  if (input.enabled) query.set("enabled", input.enabled);
  if (input.usage) query.set("usage", input.usage);
  if (input.probe) query.set("probe", input.probe);
  if (input.assignment) query.set("assignment", input.assignment);
  if (input.sortBy && input.sortOrder) {
    query.set("sortBy", input.sortBy);
    query.set("sortOrder", input.sortOrder);
  }
  return apiRequest(`/api/admin/v1/egress-nodes?${query}`, {}, decodeEgressNodeList);
}

export async function listAllEgressNodes(input: Omit<ListEgressNodesInput, "page" | "pageSize"> = {}): Promise<EgressNodeListDTO> {
  const pageSize = 2000;
  const first = await listEgressNodes({ ...input, page: 1, pageSize });
  const items = [...first.items];
  for (let page = 2; items.length < first.total; page += 1) {
    const next = await listEgressNodes({ ...input, page, pageSize });
    if (next.items.length === 0) break;
    items.push(...next.items);
  }
  return { ...first, items, page: 1, pageSize, total: items.length };
}

export function createEgressNode(input: EgressNodeInput): Promise<EgressNodeDTO> {
  return apiRequest("/api/admin/v1/egress-nodes", { method: "POST", body: input }, decodeEgressNode);
}

export function updateEgressNode(id: string, input: EgressNodeInput): Promise<EgressNodeDTO> {
  return apiRequest(`/api/admin/v1/egress-nodes/${id}`, { method: "PUT", body: input }, decodeEgressNode);
}

export function getEgressNodeProxyURL(id: string): Promise<{ proxyURL: string }> {
  return apiRequest(`/api/admin/v1/egress-nodes/${id}/proxy-url/reveal`, { method: "POST" }, createObjectDecoder<{ proxyURL: string }>("egress proxy URL", { proxyURL: isString }));
}

export function listEgressProxyProfiles(input: { page?: number; pageSize?: number; search?: string } = {}): Promise<EgressProxyProfileListDTO> {
	const query = new URLSearchParams({ page: String(input.page ?? 1), pageSize: String(input.pageSize ?? 20) });
	if (input.search) query.set("search", input.search);
	return apiRequest(`/api/admin/v1/egress-proxy-profiles?${query}`, {}, decodeEgressProxyProfiles);
}

export function createEgressProxyProfile(input: EgressProxyProfileInput): Promise<EgressProxyProfileDTO> {
  return apiRequest("/api/admin/v1/egress-proxy-profiles", { method: "POST", body: input }, decodeEgressProxyProfile);
}

export function getEgressProxyProfile(id: string): Promise<EgressProxyProfileDTO> {
	return apiRequest(`/api/admin/v1/egress-proxy-profiles/${id}`, {}, decodeEgressProxyProfile);
}

export function updateEgressProxyProfile(id: string, input: EgressProxyProfileInput): Promise<EgressProxyProfileDTO> {
  return apiRequest(`/api/admin/v1/egress-proxy-profiles/${id}`, { method: "PUT", body: input }, decodeEgressProxyProfile);
}

export function deleteEgressProxyProfile(id: string): Promise<{ deleted: boolean }> {
  return apiRequest(`/api/admin/v1/egress-proxy-profiles/${id}`, { method: "DELETE" }, decodeBooleanResult<{ deleted: boolean }>("deleted"));
}

export function getEgressProxyProfileURL(id: string): Promise<{ proxyURL: string }> {
  return apiRequest(`/api/admin/v1/egress-proxy-profiles/${id}/proxy-url/reveal`, { method: "POST" }, createObjectDecoder<{ proxyURL: string }>("egress proxy profile URL", { proxyURL: isString }));
}

export function deleteEgressNode(id: string): Promise<{ deleted: boolean }> {
  return apiRequest(`/api/admin/v1/egress-nodes/${id}`, { method: "DELETE" }, decodeBooleanResult<{ deleted: boolean }>("deleted"));
}

export function deleteEgressNodes(ids: string[]): Promise<{ deleted: number }> {
  return apiRequest("/api/admin/v1/egress-nodes", { method: "DELETE", body: { ids } }, createObjectDecoder<{ deleted: number }>("egress node batch delete", { deleted: isNumber }));
}

export function updateEgressNodesEnabled(ids: string[], enabled: boolean): Promise<{ updated: number }> {
  return apiRequest("/api/admin/v1/egress-nodes/batch", { method: "PATCH", body: { ids, enabled } }, createObjectDecoder<{ updated: number }>("egress node batch update", { updated: isNumber }));
}

export function previewUnhealthyEgressNodes(): Promise<EgressUnhealthyCleanupPreviewDTO> {
  return apiRequest("/api/admin/v1/egress-nodes/cleanup-preview", {}, createObjectDecoder<EgressUnhealthyCleanupPreviewDTO>("egress node cleanup preview", {
    nodes: isNumber, boundAccounts: isNumber, subscriptionManaged: isNumber,
  }));
}

export function cleanupUnhealthyEgressNodes(): Promise<{ deleted: number }> {
  return apiRequest("/api/admin/v1/egress-nodes/cleanup", { method: "POST" }, createObjectDecoder<{ deleted: number }>("egress node cleanup", { deleted: isNumber }));
}

export function refreshEgressClearance(id: string): Promise<{ refreshed: boolean }> {
  return apiRequest(`/api/admin/v1/egress-nodes/${id}/refresh-clearance`, { method: "POST" }, decodeBooleanResult<{ refreshed: boolean }>("refreshed"));
}

export function testEgressNode(id: string): Promise<EgressProbeResultDTO> {
  return apiRequest(`/api/admin/v1/egress-nodes/${id}/test`, { method: "POST" }, decodeEgressProbeResult);
}

export function testEgressNodes(ids?: string[]): Promise<EgressProbeBatchResultDTO> {
  return apiRequest("/api/admin/v1/egress-nodes/test", { method: "POST", body: { ids: ids ?? [] } }, decodeEgressProbeBatchResult);
}

type ListEgressSourcesInput = {
  page?: number;
  pageSize?: number;
  search?: string;
  scope?: EgressScope;
};

export function listEgressSources(input?: ListEgressSourcesInput): Promise<EgressSourceListDTO> {
  if (!input) return apiRequest("/api/admin/v1/egress-sources", {}, decodeEgressSourceList);
  const query = new URLSearchParams({ page: String(input.page ?? 1), pageSize: String(input.pageSize ?? 20) });
  if (input.search) query.set("search", input.search);
  if (input.scope) query.set("scope", input.scope);
  return apiRequest(`/api/admin/v1/egress-sources?${query}`, {}, decodeEgressSourceList);
}

export function createEgressSource(input: EgressSourceInput): Promise<EgressSourceDTO> {
  return apiRequest("/api/admin/v1/egress-sources", { method: "POST", body: input }, decodeEgressSource);
}

export function updateEgressSource(id: string, input: EgressSourceInput): Promise<EgressSourceDTO> {
  return apiRequest(`/api/admin/v1/egress-sources/${id}`, { method: "PUT", body: input }, decodeEgressSource);
}

export function deleteEgressSource(id: string): Promise<{ deleted: boolean }> {
  return apiRequest(`/api/admin/v1/egress-sources/${id}`, { method: "DELETE" }, decodeBooleanResult<{ deleted: boolean }>("deleted"));
}

export function syncEgressSource(id: string): Promise<EgressImportResultDTO> {
  return apiRequest(`/api/admin/v1/egress-sources/${id}/sync`, { method: "POST" }, (value) => withEgressImportResultDefaults(decodeEgressImportResult(value)));
}

export function importEgressText(input: { name: string; scope: EgressScope; accountCapacity: number; usage?: EgressUsage; content: string }): Promise<EgressImportResultDTO> {
  return apiRequest("/api/admin/v1/egress-imports", { method: "POST", body: input }, (value) => withEgressImportResultDefaults(decodeEgressImportResult(value)));
}

export function getEgressOperationsConfig(): Promise<EgressOperationsConfigDTO> {
  return apiRequest("/api/admin/v1/egress-operations", {}, decodeEgressOperationsConfig);
}

export function updateEgressOperationsConfig(input: Omit<EgressOperationsConfigDTO, "updatedAt">): Promise<EgressOperationsConfigDTO> {
  return apiRequest("/api/admin/v1/egress-operations", { method: "PUT", body: input }, decodeEgressOperationsConfig);
}

export function rebalanceEgressAccounts(): Promise<EgressRebalanceResultDTO> {
  return apiRequest("/api/admin/v1/egress-operations/rebalance", { method: "POST" }, (value) => withEgressRebalanceDefaults(decodeEgressRebalanceResult(value)));
}

const decodeEgressNodeAccounts = createObjectDecoder<EgressNodeAccountsDTO>("egress node accounts", {
  accounts: isArrayOf(hasShape({ id: isNumber, provider: isString, name: isString, email: isOptional(isString), enabled: isBoolean, authStatus: isString, assignmentMode: isString })),
});

export function listEgressNodeAccounts(nodeID: string): Promise<EgressNodeAccountsDTO> {
  return apiRequest(`/api/admin/v1/egress-operations/nodes/${encodeURIComponent(nodeID)}/accounts`, { method: "GET" }, decodeEgressNodeAccounts);
}

export type AccountQualityProbeConfirmationDTO = {
  requestId: string; nodeId: string; statusCode: number;
  firstTokenMs: number; durationMs: number; outputTokens: number; reasoningTokens: number;
  visibleCharacters: number; outputTokensPerSecond: number;
  thinkingObserved: boolean; missingThinking: boolean;
};

export type AccountQualityProbeResultDTO = {
  requestId: string; accountId: string; nodeId: string; model: string; kind?: string; statusCode: number;
  firstTokenMs: number; durationMs: number; outputTokens: number; reasoningTokens: number;
  visibleCharacters: number; outputTokensPerSecond: number;
  thinkingObserved: boolean; missingThinking: boolean; action: string;
  overturned?: boolean;
  confirmation?: AccountQualityProbeConfirmationDTO | null;
};

export function probeAccountQuality(accountID: string, input: { clientKeyID?: string; model?: string; prompt?: string; maxOutputTokens?: number; kind?: string } = {}): Promise<AccountQualityProbeResultDTO> {
  return apiRequest(`/api/admin/v1/egress-operations/accounts/${accountID}/quality-probe`, { method: "POST", body: input }, createObjectDecoder<AccountQualityProbeResultDTO>("account quality probe", {
    requestId: isString, accountId: isString, nodeId: isString, model: isString, statusCode: isNumber,
    kind: isOptional(isString),
    firstTokenMs: isNumber, durationMs: isNumber, outputTokens: isNumber, reasoningTokens: isNumber,
    visibleCharacters: isNumber, outputTokensPerSecond: isNumber,
    thinkingObserved: isBoolean, missingThinking: isBoolean, action: isString,
    overturned: isOptional(isBoolean),
    confirmation: isOptional(hasShape({
      requestId: isString, nodeId: isString, statusCode: isNumber,
      firstTokenMs: isNumber, durationMs: isNumber, outputTokens: isNumber, reasoningTokens: isNumber,
      visibleCharacters: isNumber, outputTokensPerSecond: isNumber,
      thinkingObserved: isBoolean, missingThinking: isBoolean,
    })),
  }));
}

export function assignEgressAccounts(nodeID: string, provider: "grok_build" | "grok_web" | "grok_console", ids: string[], mode: "manual" | "auto" = "manual"): Promise<{ assigned: number }> {
  return apiRequest(`/api/admin/v1/egress-nodes/${nodeID}/accounts`, { method: "POST", body: { provider, ids, mode } }, createObjectDecoder<{ assigned: number }>("egress account assignment", { assigned: isNumber }));
}

export function unassignEgressAccounts(provider: "grok_build" | "grok_web" | "grok_console", ids: string[]): Promise<{ assigned: number }> {
  return apiRequest("/api/admin/v1/egress-nodes/accounts", { method: "DELETE", body: { provider, ids } }, createObjectDecoder<{ assigned: number }>("egress account assignment", { assigned: isNumber }));
}

export type ProbeSampleDTO = {
  id: string; requestId: string; source: string; round: number; kind: string;
  accountId: string; accountName: string; egressNodeId: string; egressNodeName: string;
  model: string; classification: string; action?: string; manualFlag?: string;
  missingThinking: boolean; thinkingObserved: boolean;
  visiblePreview: string; visibleLength: number; reasoningLength: number;
  outputTokens: number; reasoningTokens: number;
  firstTokenMs: number; durationMs: number; outputTokensPerSecond: number; createdAt: string;
};

export type ProbeSampleDetailDTO = ProbeSampleDTO & {
  visibleText: string; visibleTruncated: boolean;
  reasoningText: string; reasoningTruncated: boolean;
};

export type ProbeSampleListDTO = { items: ProbeSampleDTO[]; total: number; page: number; pageSize: number };

const decodeProbeSample = hasShape({
  id: isString, requestId: isString, source: isString, round: isNumber, kind: isString,
  accountId: isString, accountName: isString, egressNodeId: isString, egressNodeName: isString,
  model: isString, classification: isString, action: isOptional(isString), manualFlag: isOptional(isString),
  missingThinking: isBoolean, thinkingObserved: isBoolean,
  visiblePreview: isString, visibleLength: isNumber, reasoningLength: isNumber,
  outputTokens: isNumber, reasoningTokens: isNumber,
  firstTokenMs: isNumber, durationMs: isNumber, outputTokensPerSecond: isNumber, createdAt: isString,
});

export function listProbeSamples(input: { page?: number; pageSize?: number; classification?: string; kind?: string; manualFlag?: string; search?: string; accountId?: string } = {}): Promise<ProbeSampleListDTO> {
  const params = new URLSearchParams();
  if (input.page && input.page > 1) params.set("page", String(input.page));
  if (input.pageSize && input.pageSize !== 20) params.set("pageSize", String(input.pageSize));
  if (input.classification) params.set("classification", input.classification);
  if (input.kind) params.set("kind", input.kind);
  if (input.manualFlag) params.set("manualFlag", input.manualFlag);
  if (input.search) params.set("search", input.search);
  if (input.accountId) params.set("accountId", input.accountId);
  const query = params.toString();
  return apiRequest(`/api/admin/v1/quality-guard/probe-samples${query ? `?${query}` : ""}`, { method: "GET" }, createObjectDecoder<ProbeSampleListDTO>("probe samples", {
    items: isArrayOf(decodeProbeSample), total: isNumber, page: isNumber, pageSize: isNumber,
  }));
}

export function getProbeSample(id: string): Promise<ProbeSampleDetailDTO> {
  return apiRequest(`/api/admin/v1/quality-guard/probe-samples/${encodeURIComponent(id)}`, { method: "GET" }, createObjectDecoder<ProbeSampleDetailDTO>("probe sample", {
    ...decodeProbeSample,
    visibleText: isString, visibleTruncated: isBoolean, reasoningText: isString, reasoningTruncated: isBoolean,
  }));
}

export function markProbeSample(id: string, flag: "" | "suspected" | "normal"): Promise<ProbeSampleDTO> {
  return apiRequest(`/api/admin/v1/quality-guard/probe-samples/${encodeURIComponent(id)}/manual-flag`, { method: "POST", body: { flag } }, createValidatedDecoder<ProbeSampleDTO>("probe sample mark", decodeProbeSample));
}

export function markProbeSamples(ids: string[], flag: "" | "suspected" | "normal"): Promise<{ updated: number }> {
  return apiRequest("/api/admin/v1/quality-guard/probe-samples/manual-flag", { method: "POST", body: { ids, flag } }, createObjectDecoder<{ updated: number }>("probe samples batch mark", { updated: isNumber }));
}

export function deleteProbeSample(id: string): Promise<{ deleted: number }> {
  return apiRequest(`/api/admin/v1/quality-guard/probe-samples/${encodeURIComponent(id)}`, { method: "DELETE" }, createObjectDecoder<{ deleted: number }>("probe sample delete", { deleted: isNumber }));
}

export function deleteProbeSamples(ids: string[]): Promise<{ deleted: number }> {
  return apiRequest("/api/admin/v1/quality-guard/probe-samples", { method: "DELETE", body: { ids } }, createObjectDecoder<{ deleted: number }>("probe samples delete", { deleted: isNumber }));
}

export function quarantineProbeSampleAccount(accountId: string, hours: number): Promise<{ quarantined: boolean }> {
  return apiRequest(`/api/admin/v1/egress-operations/accounts/${encodeURIComponent(accountId)}/quarantine`, { method: "POST", body: { hours } }, createObjectDecoder<{ quarantined: boolean }>("account quarantine", { quarantined: isBoolean }));
}

export function quarantineProbeSampleAccounts(accountIds: string[], hours: number): Promise<{ quarantined: number[]; missing: number[] }> {
  const ids = accountIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
  return apiRequest("/api/admin/v1/egress-operations/account-controls/quarantine", { method: "POST", body: { accountIds: ids, hours } }, createObjectDecoder<{ quarantined: number[]; missing: number[] }>("account batch quarantine", { quarantined: isArrayOf(isNumber), missing: isArrayOf(isNumber) }));
}

export function restoreProbeSampleAccount(accountId: string): Promise<{ restored: boolean }> {
  return apiRequest(`/api/admin/v1/egress-operations/accounts/${encodeURIComponent(accountId)}/restore`, { method: "POST" }, createObjectDecoder<{ restored: boolean }>("account restore", { restored: isBoolean }));
}
