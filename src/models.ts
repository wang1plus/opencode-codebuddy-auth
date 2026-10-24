import { Model, Provider } from "@opencode/plugin";
import {
  CONFIG,
  DISCOVERY_TIMEOUT_MS,
  type CodeBuddyEnvironment,
} from "./config.js";

export interface RemoteModelReasoning {
  effort?: string;
  summary?: string;
  supportedEfforts?: string[];
  canDisableThinking?: boolean;
  defaultEffort?: string;
}

export interface RemoteModelBadge {
  color?: string | null;
  display?: string | null;
  label?: string | null;
}

export interface RemoteModelHover {
  textZh?: string | null;
}

export interface RemoteModelPromotion {
  enabled?: boolean;
  modelIds?: string[];
  priority?: number;
  tier?: string;
  badge?: RemoteModelBadge | null;
  hover?: RemoteModelHover | null;
  schedule?: {
    timezone?: string;
    validFrom?: string;
    validUntil?: string;
    daily?: Array<{ start: string; end: string }>;
  };
}

export interface RemoteModel {
  id: string;
  name: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  supportsToolCall?: boolean;
  supportsImages?: boolean;
  supportsReasoning?: boolean;
  onlyReasoning?: boolean;
  reasoning?: RemoteModelReasoning;
  credits?: string | null;
  descriptionZh?: string | null;
  badge?: RemoteModelBadge | null;
  hover?: RemoteModelHover | null;
}

export interface RemoteConfigResponse {
  code: number;
  data?: {
    agents?: Array<{ name: string; models?: string[] }>;
    models?: RemoteModel[];
    modelPromotions?: RemoteModelPromotion[];
    modelTiers?: RemoteModelPromotion[];
  };
}

/**
 * Deeply strip `readonly` from a schema type while preserving branded
 * primitives (`string & Brand<...>`, number, unions, literals).
 * `Model.Info` (and its `Model.Info.default()` result) is declared as a
 * readonly struct; we need a mutable copy to fill in discovered model
 * metadata before it is registered.
 */
export type DeepMutable<A> = A extends
  | null
  | undefined
  | boolean
  | number
  | bigint
  | string
  | symbol
  | ((...args: never[]) => unknown)
  ? A
  : A extends ReadonlyArray<infer I>
    ? Array<DeepMutable<I>>
    : A extends ReadonlyMap<infer K, infer V>
      ? Map<DeepMutable<K>, DeepMutable<V>>
      : A extends object
        ? { -readonly [K in keyof A]: DeepMutable<A[K]> }
        : A;

export type MutableInfo = DeepMutable<Model.Info>;

export const DEFAULT_MODEL: RemoteModel = {
  id: "auto",
  name: "Auto",
  maxInputTokens: 168000,
  maxOutputTokens: 32000,
  supportsToolCall: true,
  supportsImages: true,
  supportsReasoning: true,
  onlyReasoning: true,
  reasoning: { effort: "high", summary: "auto" },
};

export function formatCredits(credits?: string | null): string | undefined {
  if (!credits) return undefined;
  if (credits === "x0.00" || credits === "x0" || credits === "0.00") return "Free";
  return credits;
}

export function remoteBadgeLabel(badge?: RemoteModelBadge | null): string | undefined {
  return badge?.label?.trim() || undefined;
}

export function remoteHoverText(hover?: RemoteModelHover | null): string | undefined {
  return hover?.textZh?.trim() || undefined;
}

export function modelTierBadgeColor(tier?: string): string | undefined {
  if (tier === "standard" || tier === "trial") return "#00B159";
  if (tier === "advanced" || tier === "flagship") return "#C0701F";
  return undefined;
}

function timeToMinutes(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return hour * 60 + minute;
}

export function isPromotionActive(
  promotion: RemoteModelPromotion,
  now = new Date(),
): boolean {
  if (promotion.enabled === false) return false;
  const from = promotion.schedule?.validFrom
    ? Date.parse(promotion.schedule.validFrom)
    : undefined;
  const until = promotion.schedule?.validUntil
    ? Date.parse(promotion.schedule.validUntil)
    : undefined;
  if (from !== undefined && !Number.isNaN(from) && now.getTime() < from) return false;
  if (until !== undefined && !Number.isNaN(until) && now.getTime() >= until) return false;

  const daily = promotion.schedule?.daily;
  if (!daily?.length) return true;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: promotion.schedule?.timezone || "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
    const current = hour * 60 + minute;
    return daily.some((range) => {
      const start = timeToMinutes(range.start);
      const end = timeToMinutes(range.end);
      if (start === undefined || end === undefined) return false;
      if (start === end) return true;
      return start < end
        ? current >= start && current < end
        : current >= start || current < end;
    });
  } catch {
    return false;
  }
}

/**
 * Turn a `/v3/config` payload into the craft agent's model inventory,
 * applying tier/promotion badges and dropping models that cannot call tools.
 */
export function parseRemoteModels(body: RemoteConfigResponse): RemoteModel[] {
  if (body.code !== 0 || !body.data) return [];
  const allModels = body.data.models || [];
  const modelMap = new Map(allModels.map((m) => [m.id, m]));
  const promotionBadges = new Map<string, RemoteModelBadge>();
  const promotionHovers = new Map<string, RemoteModelHover>();
  const modelHighlights = [
    ...(body.data.modelPromotions || []),
    ...(body.data.modelTiers || []).map((tier) => {
      const color = tier.badge?.color || modelTierBadgeColor(tier.tier);
      return tier.badge && color
        ? { ...tier, badge: { ...tier.badge, color } }
        : tier;
    }),
  ];
  for (const promotion of modelHighlights.sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
  )) {
    const active = isPromotionActive(promotion);
    for (const modelId of promotion.modelIds || []) {
      if (
        (active || promotion.badge?.display === "always") &&
        remoteBadgeLabel(promotion.badge) &&
        promotion.badge &&
        !promotionBadges.has(modelId)
      ) {
        promotionBadges.set(modelId, promotion.badge);
      }
      if (
        active &&
        remoteHoverText(promotion.hover) &&
        promotion.hover &&
        !promotionHovers.has(modelId)
      ) {
        promotionHovers.set(modelId, promotion.hover);
      }
    }
  }
  const craftAgent = (body.data.agents || []).find((a) => a.name === CONFIG.agentIntent);
  const craftIds = craftAgent?.models || [];
  if (craftIds.length === 0) return [DEFAULT_MODEL];
  return craftIds
    .map((id) => {
      const model = modelMap.get(id);
      if (!model) return model;
      const badge = promotionBadges.get(id);
      const hover = promotionHovers.get(id);
      const resolvedBadge = remoteBadgeLabel(model.badge)
        ? model.badge
        : badge
          ? { ...model.badge, ...badge }
          : model.badge;
      const resolvedHover = remoteHoverText(model.hover)
        ? model.hover
        : hover
          ? { ...model.hover, ...hover }
          : model.hover;
      return {
        ...model,
        ...(resolvedBadge ? { badge: resolvedBadge } : {}),
        ...(resolvedHover ? { hover: resolvedHover } : {}),
      };
    })
    .filter((m): m is RemoteModel => !!m?.supportsToolCall);
}

export function remoteModelToInfo(m: RemoteModel, providerID: Provider.ID): Model.Info {
  const info = Model.Info.default(
    providerID,
    Model.ID.make(m.id),
  ) as unknown as MutableInfo;
  const creditLabel = formatCredits(m.credits);
  info.name = creditLabel ? `${m.name} (${creditLabel})` : m.name;
  if (m.maxInputTokens || m.maxOutputTokens) {
    info.limit.context = m.maxInputTokens ?? 0;
    info.limit.output = m.maxOutputTokens ?? 0;
  }
  info.capabilities = {
    tools: m.supportsToolCall ?? true,
    input: m.supportsImages ? ["text", "image"] : ["text"],
    output: ["text"],
  };

  const settings: Record<string, unknown> = {};
  const effort = m.reasoning?.effort ?? m.reasoning?.defaultEffort;
  if (effort) settings.reasoningEffort = effort;
  if (m.reasoning?.summary) info.body = { reasoning_summary: m.reasoning.summary };

  // Every supported effort becomes a selectable model variant; "none" is only
  // offered when the upstream model explicitly allows disabling thinking.
  const supportedEfforts = Array.from(
    new Set(
      (m.reasoning?.supportedEfforts ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0 && value !== "none"),
    ),
  );
  const variantEfforts = [
    ...(m.reasoning?.canDisableThinking ? ["none"] : []),
    ...supportedEfforts,
  ];
  info.variants = variantEfforts.map((variantEffort) => ({
    id: Model.VariantID.make(variantEffort),
    settings: { reasoningEffort: variantEffort },
  })) as Model.Variant[];

  const supportsReasoning =
    m.supportsReasoning ||
    m.onlyReasoning ||
    (m.reasoning?.supportedEfforts?.length ?? 0) > 0;
  if (supportsReasoning) {
    info.compatibility = {
      ...(info.compatibility ?? {}),
      reasoningField: "reasoning_content",
      ...(m.onlyReasoning ? { requireReasoning: true } : {}),
      supportsPromptCacheKey: true,
    };
  } else {
    info.compatibility = {
      ...(info.compatibility ?? {}),
      supportsPromptCacheKey: true,
    };
  }

  const badgeLabel = remoteBadgeLabel(m.badge);
  const hoverTextZh = remoteHoverText(m.hover);
  const descriptionZh = m.descriptionZh?.trim();
  if (badgeLabel || hoverTextZh || descriptionZh) {
    const tui: Record<string, unknown> = { name: info.name };
    if (descriptionZh) tui.descriptionZh = descriptionZh;
    if (badgeLabel) {
      tui.badge = {
        label: badgeLabel,
        ...(m.badge?.color ? { color: m.badge.color } : {}),
      };
    }
    if (hoverTextZh) tui.hover = { textZh: hoverTextZh };
    settings.tui = tui;
  }

  if (Object.keys(settings).length > 0) info.settings = settings;
  return info as Model.Info;
}

export function defaultModelInfo(providerID: Provider.ID): Model.Info {
  return remoteModelToInfo(DEFAULT_MODEL, providerID);
}

export async function fetchRemoteModels(
  accessToken: string,
  environment: CodeBuddyEnvironment,
): Promise<RemoteModel[]> {
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
    Authorization: `Bearer ${accessToken}`,
    "X-Agent-Intent": CONFIG.agentIntent,
    "X-IDE-Type": CONFIG.ideType,
    "X-IDE-Name": CONFIG.ideName,
    "X-IDE-Version": CONFIG.ideVersion,
    "X-Product-Version": CONFIG.appVersion,
    "X-Env-ID": CONFIG.envId,
    "X-Domain": environment.domain,
    "X-Product": CONFIG.product,
    "User-Agent": `${CONFIG.ideName}/${CONFIG.ideVersion} CodeBuddy/${CONFIG.appVersion}`,
  };
  const resp = await fetch(`${environment.serverUrl}/v3/config`, { headers });
  if (!resp.ok) return [];
  const body = (await resp.json()) as RemoteConfigResponse;
  return parseRemoteModels(body);
}

export async function fetchRemoteModelsWithTimeout(
  accessToken: string,
  environment: CodeBuddyEnvironment,
  timeoutMs = DISCOVERY_TIMEOUT_MS,
): Promise<RemoteModel[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetchRemoteModels(accessToken, environment),
      new Promise<RemoteModel[]>((resolve) => {
        timer = setTimeout(() => resolve([]), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
