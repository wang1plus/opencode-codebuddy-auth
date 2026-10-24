import { Model } from "@opencode/plugin";
import { CONFIG, DISCOVERY_TIMEOUT_MS, } from "./config.js";
export const DEFAULT_MODEL = {
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
export function formatCredits(credits) {
    if (!credits)
        return undefined;
    if (credits === "x0.00" || credits === "x0" || credits === "0.00")
        return "Free";
    return credits;
}
export function remoteBadgeLabel(badge) {
    return badge?.label?.trim() || undefined;
}
export function remoteHoverText(hover) {
    return hover?.textZh?.trim() || undefined;
}
export function modelTierBadgeColor(tier) {
    if (tier === "standard" || tier === "trial")
        return "#00B159";
    if (tier === "advanced" || tier === "flagship")
        return "#C0701F";
    return undefined;
}
function timeToMinutes(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value);
    if (!match)
        return undefined;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59)
        return undefined;
    return hour * 60 + minute;
}
export function isPromotionActive(promotion, now = new Date()) {
    if (promotion.enabled === false)
        return false;
    const from = promotion.schedule?.validFrom
        ? Date.parse(promotion.schedule.validFrom)
        : undefined;
    const until = promotion.schedule?.validUntil
        ? Date.parse(promotion.schedule.validUntil)
        : undefined;
    if (from !== undefined && !Number.isNaN(from) && now.getTime() < from)
        return false;
    if (until !== undefined && !Number.isNaN(until) && now.getTime() >= until)
        return false;
    const daily = promotion.schedule?.daily;
    if (!daily?.length)
        return true;
    try {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: promotion.schedule?.timezone || "UTC",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        }).formatToParts(now);
        const hour = Number(parts.find((part) => part.type === "hour")?.value);
        const minute = Number(parts.find((part) => part.type === "minute")?.value);
        if (!Number.isFinite(hour) || !Number.isFinite(minute))
            return false;
        const current = hour * 60 + minute;
        return daily.some((range) => {
            const start = timeToMinutes(range.start);
            const end = timeToMinutes(range.end);
            if (start === undefined || end === undefined)
                return false;
            if (start === end)
                return true;
            return start < end
                ? current >= start && current < end
                : current >= start || current < end;
        });
    }
    catch {
        return false;
    }
}
/**
 * Turn a `/v3/config` payload into the craft agent's model inventory,
 * applying tier/promotion badges and dropping models that cannot call tools.
 */
export function parseRemoteModels(body) {
    if (body.code !== 0 || !body.data)
        return [];
    const allModels = body.data.models || [];
    const modelMap = new Map(allModels.map((m) => [m.id, m]));
    const promotionBadges = new Map();
    const promotionHovers = new Map();
    const modelHighlights = [
        ...(body.data.modelPromotions || []),
        ...(body.data.modelTiers || []).map((tier) => {
            const color = tier.badge?.color || modelTierBadgeColor(tier.tier);
            return tier.badge && color
                ? { ...tier, badge: { ...tier.badge, color } }
                : tier;
        }),
    ];
    for (const promotion of modelHighlights.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))) {
        const active = isPromotionActive(promotion);
        for (const modelId of promotion.modelIds || []) {
            if ((active || promotion.badge?.display === "always") &&
                remoteBadgeLabel(promotion.badge) &&
                promotion.badge &&
                !promotionBadges.has(modelId)) {
                promotionBadges.set(modelId, promotion.badge);
            }
            if (active &&
                remoteHoverText(promotion.hover) &&
                promotion.hover &&
                !promotionHovers.has(modelId)) {
                promotionHovers.set(modelId, promotion.hover);
            }
        }
    }
    const craftAgent = (body.data.agents || []).find((a) => a.name === CONFIG.agentIntent);
    const craftIds = craftAgent?.models || [];
    if (craftIds.length === 0)
        return [DEFAULT_MODEL];
    return craftIds
        .map((id) => {
        const model = modelMap.get(id);
        if (!model)
            return model;
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
        .filter((m) => !!m?.supportsToolCall);
}
export function remoteModelToInfo(m, providerID) {
    const info = Model.Info.default(providerID, Model.ID.make(m.id));
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
    const settings = {};
    const effort = m.reasoning?.effort ?? m.reasoning?.defaultEffort;
    if (effort)
        settings.reasoningEffort = effort;
    if (m.reasoning?.summary)
        info.body = { reasoning_summary: m.reasoning.summary };
    // Every supported effort becomes a selectable model variant; "none" is only
    // offered when the upstream model explicitly allows disabling thinking.
    const supportedEfforts = Array.from(new Set((m.reasoning?.supportedEfforts ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0 && value !== "none")));
    const variantEfforts = [
        ...(m.reasoning?.canDisableThinking ? ["none"] : []),
        ...supportedEfforts,
    ];
    info.variants = variantEfforts.map((variantEffort) => ({
        id: Model.VariantID.make(variantEffort),
        settings: { reasoningEffort: variantEffort },
    }));
    const supportsReasoning = m.supportsReasoning ||
        m.onlyReasoning ||
        (m.reasoning?.supportedEfforts?.length ?? 0) > 0;
    if (supportsReasoning) {
        info.compatibility = {
            ...(info.compatibility ?? {}),
            reasoningField: "reasoning_content",
            ...(m.onlyReasoning ? { requireReasoning: true } : {}),
            supportsPromptCacheKey: true,
        };
    }
    else {
        info.compatibility = {
            ...(info.compatibility ?? {}),
            supportsPromptCacheKey: true,
        };
    }
    const badgeLabel = remoteBadgeLabel(m.badge);
    const hoverTextZh = remoteHoverText(m.hover);
    const descriptionZh = m.descriptionZh?.trim();
    if (badgeLabel || hoverTextZh || descriptionZh) {
        const tui = { name: info.name };
        if (descriptionZh)
            tui.descriptionZh = descriptionZh;
        if (badgeLabel) {
            tui.badge = {
                label: badgeLabel,
                ...(m.badge?.color ? { color: m.badge.color } : {}),
            };
        }
        if (hoverTextZh)
            tui.hover = { textZh: hoverTextZh };
        settings.tui = tui;
    }
    if (Object.keys(settings).length > 0)
        info.settings = settings;
    return info;
}
export function defaultModelInfo(providerID) {
    return remoteModelToInfo(DEFAULT_MODEL, providerID);
}
export async function fetchRemoteModels(accessToken, environment) {
    const headers = {
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
    if (!resp.ok)
        return [];
    const body = (await resp.json());
    return parseRemoteModels(body);
}
export async function fetchRemoteModelsWithTimeout(accessToken, environment, timeoutMs = DISCOVERY_TIMEOUT_MS) {
    let timer;
    try {
        return await Promise.race([
            fetchRemoteModels(accessToken, environment),
            new Promise((resolve) => {
                timer = setTimeout(() => resolve([]), timeoutMs);
            }),
        ]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
