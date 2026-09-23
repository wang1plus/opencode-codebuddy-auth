import {
  Credential,
  Integration,
  Model,
  Plugin,
  Provider,
} from "@opencode/plugin";

const PROVIDER_ID = "codebuddy";
const AUTH_METHOD_ID = "ioa";
const PROVIDER_PACKAGE = "@opencode/ai/providers/openai-compatible";

const CONFIG = {
  serverUrl: "https://copilot.tencent.com",
  chatCompletionsPath: "/v2/chat/completions",
  platform: "VSCode",
  appVersion: "4.9.29177644",
  ideName: "VSCode",
  ideType: "VSCode",
  ideVersion: "1.119.0",
  domain: "www.codebuddy.cn",
  product: "SaaS",
  agentIntent: "craft",
  envId: "production",
  tenantId: process.env.CODEBUDDY_TENANT_ID || "",
  enterpriseId: process.env.CODEBUDDY_ENTERPRISE_ID || "",
  userId: process.env.CODEBUDDY_USER_ID || "",
  defaultModel: process.env.CODEBUDDY_DEFAULT_MODEL || "",
};

interface JwtPayload {
  iss?: string;
  tenant_id?: string;
  tenantId?: string;
  enterprise_id?: string;
  enterpriseId?: string;
  ent_id?: string;
  entId?: string;
  user_id?: string;
  userId?: string;
  uid?: string;
  sub?: string;
  realm_access?: { roles?: string[] };
  resource_access?: { account?: { roles?: string[] } };
}

interface AuthStateResponse {
  code: number;
  data?: {
    state: string;
    authUrl?: string;
  };
}

interface TokenPollResponse {
  code: number;
  data?: {
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  };
}

interface RefreshResponse {
  code: number;
  data?: {
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  };
}

interface OpenAIRequest {
  model?: string;
  stream?: boolean;
  response_format?: unknown;
  [key: string]: unknown;
}

interface RemoteModelReasoning {
  effort?: string;
  summary?: string;
  supportedEfforts?: string[];
  canDisableThinking?: boolean;
  defaultEffort?: string;
}

interface RemoteModelBadge {
  color?: string | null;
  display?: string | null;
  label?: string | null;
}

interface RemoteModelHover {
  textZh?: string | null;
}

interface RemoteModelPromotion {
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

interface RemoteModel {
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

interface RemoteConfigResponse {
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
 * primitives (`string & Brand<...>`, `number & Brand<...>`, unions, literals).
 * `Model.Info` (and its `Model.Info.default()` result) is declared as a
 * readonly struct; we need a mutable copy to fill in discovered model
 * metadata before it is registered.
 */
type DeepMutable<A> = A extends
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

type MutableInfo = DeepMutable<Model.Info>;

const DEFAULT_MODEL: RemoteModel = {
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

const DISCOVERY_TIMEOUT_MS = 5000;

let resolvedServerUrl = CONFIG.serverUrl;
let resolvedDomain = CONFIG.domain;

function formatCredits(credits?: string | null): string | undefined {
  if (!credits) return undefined;
  if (credits === "x0.00" || credits === "x0" || credits === "0.00") return "Free";
  return credits;
}

function applyBaseURLOverride(baseURL: string): void {
  try {
    const u = new URL(baseURL);
    resolvedServerUrl = `${u.protocol}//${u.host}`;
    if (resolvedServerUrl.includes("codebuddy.ai")) {
      resolvedDomain = "www.codebuddy.ai";
    } else {
      resolvedDomain = CONFIG.domain;
    }
  } catch {
    // keep defaults
  }
}

function remoteBadgeLabel(badge?: RemoteModelBadge | null): string | undefined {
  return badge?.label?.trim() || undefined;
}

function remoteHoverText(hover?: RemoteModelHover | null): string | undefined {
  return hover?.textZh?.trim() || undefined;
}

function modelTierBadgeColor(tier?: string): string | undefined {
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

function isPromotionActive(promotion: RemoteModelPromotion, now = new Date()): boolean {
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

async function fetchRemoteModels(accessToken: string): Promise<RemoteModel[]> {
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
    "X-Domain": resolvedDomain,
    "X-Product": CONFIG.product,
    "User-Agent": `${CONFIG.ideName}/${CONFIG.ideVersion} CodeBuddy/${CONFIG.appVersion}`,
  };
  const resp = await fetch(`${resolvedServerUrl}/v3/config`, { headers });
  if (!resp.ok) return [];
  const body = (await resp.json()) as RemoteConfigResponse;
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

async function fetchRemoteModelsWithTimeout(accessToken: string): Promise<RemoteModel[]> {
  return Promise.race([
    fetchRemoteModels(accessToken),
    new Promise<RemoteModel[]>((resolve) =>
      setTimeout(() => resolve([]), DISCOVERY_TIMEOUT_MS),
    ),
  ]);
}

function generateUuid(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(Buffer.from(payload + pad, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function resolveTenantId(accessToken: string): string {
  if (CONFIG.tenantId) return CONFIG.tenantId;
  const p = decodeJwtPayload(accessToken);
  if (!p) return "";
  const iss = p.iss || "";
  const m = iss.match(/realms\/sso-([^/]+)$/);
  return p.tenant_id || p.tenantId || (m?.[1] || "");
}

function resolveEnterpriseId(accessToken: string): string {
  if (CONFIG.enterpriseId) return CONFIG.enterpriseId;
  const p = decodeJwtPayload(accessToken);
  if (!p) return "";
  const roles = p.realm_access?.roles || p.resource_access?.account?.roles;
  if (roles) {
    for (const r of roles) {
      const m = r.match(/group-admin:([A-Za-z0-9-]+)/);
      if (m?.[1]) return m[1];
    }
  }
  return p.enterprise_id || p.enterpriseId || p.ent_id || p.entId || "";
}

function resolveUserId(accessToken: string): string {
  if (CONFIG.userId) return CONFIG.userId;
  const p = decodeJwtPayload(accessToken);
  return p?.user_id || p?.userId || p?.uid || p?.sub || "";
}

function resolveModel(inputModel?: string): string {
  if (CONFIG.defaultModel) return CONFIG.defaultModel;
  return inputModel || "";
}

function generateTraceId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function buildAuthHeaders(
  accessToken: string,
  modelId?: string,
): Record<string, string> {
  const tenantId = resolveTenantId(accessToken);
  const enterpriseId = resolveEnterpriseId(accessToken);
  const userId = resolveUserId(accessToken);
  const conversationId = generateTraceId();
  const messageId = generateTraceId();
  const traceId = generateTraceId();
  const spanId = generateTraceId().slice(0, 16);
  const parentSpanId = generateTraceId().slice(0, 16);

  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
    Authorization: `Bearer ${accessToken}`,
    "X-Request-ID": messageId,
    "X-Conversation-ID": conversationId,
    "X-Conversation-Request-ID": messageId,
    "X-Conversation-Message-ID": messageId,
    "X-Agent-Intent": CONFIG.agentIntent,
    "X-IDE-Type": CONFIG.ideType,
    "X-IDE-Name": CONFIG.ideName,
    "X-IDE-Version": CONFIG.ideVersion,
    "X-Product-Version": CONFIG.appVersion,
    "X-Request-Trace-Id": traceId,
    "X-Env-ID": CONFIG.envId,
    "X-Domain": resolvedDomain,
    "X-Product": CONFIG.product,
    "User-Agent": `${CONFIG.ideName}/${CONFIG.ideVersion} CodeBuddy/${CONFIG.appVersion}`,
    b3: `${traceId}-${spanId}-1-${parentSpanId}`,
    "X-B3-TraceId": traceId,
    "X-B3-ParentSpanId": parentSpanId,
    "X-B3-SpanId": spanId,
    "X-B3-Sampled": "1",
  };

  if (tenantId) headers["X-Tenant-Id"] = tenantId;
  if (enterpriseId) headers["X-Enterprise-Id"] = enterpriseId;
  if (userId) headers["X-User-Id"] = userId;
  if (modelId) headers["X-Model-ID"] = modelId;

  return headers;
}

function normalizeSseLine(line: string): string {
  const carriageReturn = line.endsWith("\r") ? "\r" : "";
  const content = carriageReturn ? line.slice(0, -1) : line;
  const match = /^(\s*data:\s*)(.+)$/.exec(content);
  if (!match || match[2] === "[DONE]") return line;

  try {
    const data = JSON.parse(match[2]) as Record<string, unknown>;
    if (!Array.isArray(data.choices)) return line;
    let changed = false;
    for (const choice of data.choices) {
      if (!choice || typeof choice !== "object") continue;
      const delta = (choice as Record<string, unknown>).delta;
      if (!delta || typeof delta !== "object" || Array.isArray(delta)) continue;
      const record = delta as Record<string, unknown>;
      if (Array.isArray(record.tool_calls) && record.tool_calls.length === 0) {
        delete record.tool_calls;
        changed = true;
      }
    }
    if (!changed) return line;
    return `${match[1]}${JSON.stringify(data)}${carriageReturn}`;
  } catch {
    return line;
  }
}

function normalizeSseResponse(response: Response): Response {
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
    return response;
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          controller.enqueue(encoder.encode(`${normalizeSseLine(line)}\n`));
          newline = buffer.indexOf("\n");
        }
      },
      flush(controller) {
        buffer += decoder.decode();
        if (buffer) controller.enqueue(encoder.encode(normalizeSseLine(buffer)));
      },
    }),
  );
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestAuthState(): Promise<{ state: string; url: string }> {
  const params = new URLSearchParams({ platform: CONFIG.platform, ioa: "1" });
  const response = await fetch(
    `${resolvedServerUrl}/v2/plugin/auth/state?${params.toString()}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-No-Authorization": "true",
        "X-No-User-Id": "true",
        "X-No-Enterprise-Id": "true",
        "X-No-Department-Info": "true",
      },
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Auth state request failed: ${response.status} - ${text}`);
  }
  const data = (await response.json()) as AuthStateResponse;
  if (data.code !== 0 || !data.data?.state) {
    throw new Error(`Invalid auth state response: ${JSON.stringify(data)}`);
  }
  const loginUrl =
    data.data.authUrl ||
    `${resolvedServerUrl}/login?platform=${CONFIG.platform}&state=${data.data.state}&ioa=1`;
  return { state: data.data.state, url: loginUrl };
}

async function pollForToken(
  state: string,
  expiresAt: number,
  signal?: AbortSignal,
): Promise<TokenPollResponse["data"] | null> {
  while (Date.now() < expiresAt) {
    if (signal?.aborted) return null;
    await sleep(3000);
    try {
      const response = await fetch(
        `${resolvedServerUrl}/v2/plugin/auth/token?state=${state}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-No-Authorization": "true",
            "X-No-User-Id": "true",
            "X-No-Enterprise-Id": "true",
            "X-No-Department-Info": "true",
          },
          signal,
        },
      );
      if (response.ok) {
        const data = (await response.json()) as TokenPollResponse;
        if (data.code === 0 && data.data?.accessToken) return data.data;
      }
    } catch {
      if (signal?.aborted) return null;
    }
  }
  return null;
}

async function refreshAccessToken(
  refreshToken: string,
): Promise<RefreshResponse["data"] | null> {
  try {
    const response = await fetch(
      `${resolvedServerUrl}/v2/plugin/auth/token/refresh`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${refreshToken}`,
        },
      },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as RefreshResponse;
    if (data.code !== 0) return null;
    return data.data || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// V2 model discovery
// ---------------------------------------------------------------------------

function remoteModelToInfo(m: RemoteModel, providerID: Provider.ID): Model.Info {
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
  const supportsReasoning =
    m.supportsReasoning ||
    m.onlyReasoning ||
    (m.reasoning?.supportedEfforts?.length ?? 0) > 0;
  if (supportsReasoning) {
    info.compatibility = { ...(info.compatibility ?? {}), reasoningField: "reasoning_content" };
    const reasoningEffort = m.reasoning?.effort ?? m.reasoning?.defaultEffort;
    if (reasoningEffort) info.settings = { ...(info.settings ?? {}), reasoningEffort };
    if (m.reasoning?.summary) info.body = { ...(info.body ?? {}), reasoning_summary: m.reasoning.summary };
  }
  return info;
}

function defaultModelInfo(providerID: Provider.ID): Model.Info {
  return remoteModelToInfo(DEFAULT_MODEL, providerID);
}

async function resolveCurrentAccessToken(ctx: Plugin.Context): Promise<string> {
  try {
    const connection = await ctx.integration.connection.active(PROVIDER_ID);
    if (!connection) return "";
    const credential = await ctx.integration.connection.resolve(connection);
    return credential?.type === "oauth" ? credential.access : "";
  } catch {
    return "";
  }
}

async function refreshModelSource(ctx: Plugin.Context): Promise<Model.Info[]> {
  const token = await resolveCurrentAccessToken(ctx);
  const providerID = Provider.ID.make(PROVIDER_ID);
  if (!token) return [defaultModelInfo(providerID)];
  const discovered = await fetchRemoteModelsWithTimeout(token);
  return discovered.length > 0
    ? discovered.map((model) => remoteModelToInfo(model, providerID))
    : [defaultModelInfo(providerID)];
}

export default Plugin.define({
  id: "codebuddy-auth",
  async setup(ctx) {
    const providerID = Provider.ID.make(PROVIDER_ID);
    const integrationID = Integration.ID.make(PROVIDER_ID);

    // Current discovered model inventory. Captured by the provider transform
    // and refreshed (then replayed via `ctx.provider.reload()`) after the
    // credential changes or the user (re)connects.
    let currentModels: Model.Info[] = await refreshModelSource(ctx);

    await ctx.provider.transform((editor) => {
      const injected = new Set(currentModels.map((model) => model.id));
      const existing = editor.get(PROVIDER_ID);
      if (!existing) {
        editor.add({
          info: {
            ...Provider.Info.empty(providerID),
            name: "CodeBuddy",
            activation: "auto",
            package: PROVIDER_PACKAGE,
            integrationID,
            settings: { baseURL: `${resolvedServerUrl}/v2` },
          },
          models: currentModels,
        });
        return;
      }
      // A user-declared `providers.codebuddy` block is honored: keep its
      // baseURL (environment switch), fill in the runtime package when it was
      // omitted, and never overwrite user-declared models.
      editor.update(PROVIDER_ID, (provider) => {
        if (!provider.package) provider.package = PROVIDER_PACKAGE;
        if (!provider.integrationID) provider.integrationID = integrationID;
        const baseURL = provider.settings?.baseURL;
        if (typeof baseURL === "string" && baseURL) applyBaseURLOverride(baseURL);
      });
      const declared = [...existing.models.values()].filter(
        (model) => !injected.has(model.id),
      );
      const merged = [
        ...declared,
        ...currentModels.filter((model) => !declared.some((item) => item.id === model.id)),
      ];
      editor.models.set(PROVIDER_ID, merged);
    });

    await ctx.integration.transform((editor) => {
      editor.update(PROVIDER_ID, (integration) => {
        integration.name = "CodeBuddy";
      });
      editor.method.update({
        integrationID,
        method: {
          id: Integration.MethodID.make(AUTH_METHOD_ID),
          type: "oauth",
          label: "IOA 登录 (浏览器)",
        },
        async authorize() {
          const authState = await requestAuthState();
          const expiresAt = Date.now() + 10 * 60 * 1000;
          const callback = pollForToken(authState.state, expiresAt).then(
            (tokenData): Credential.OAuth => {
              if (!tokenData?.accessToken) {
                throw new Error("IOA 登录超时或已取消，请重试");
              }
              return {
                type: "oauth",
                methodID: Integration.MethodID.make(AUTH_METHOD_ID),
                access: tokenData.accessToken,
                refresh: tokenData.refreshToken || "",
                expires: tokenData.expiresIn
                  ? Date.now() + tokenData.expiresIn * 1000
                  : Date.now() + 24 * 60 * 60 * 1000,
              };
            },
          );
          return {
            url: authState.url,
            instructions: "请在浏览器中完成 IOA 登录",
            mode: "auto",
            callback,
          };
        },
        async refresh(credential) {
          if (!credential.refresh) return credential;
          const refreshed = await refreshAccessToken(credential.refresh);
          if (!refreshed?.accessToken) return credential;
          return {
            ...credential,
            access: refreshed.accessToken,
            refresh: refreshed.refreshToken || credential.refresh,
            expires: refreshed.expiresIn
              ? Date.now() + refreshed.expiresIn * 1000
              : credential.expires,
          };
        },
      });
    });

    await ctx.session.hook(
      "http.request",
      async (event) => {
        const original = event.request;

        // The core injects the OAuth access token as a bearer credential before
        // this hook runs. Fall back to resolving it ourselves when absent.
        let accessToken =
          original.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
        if (!accessToken) {
          const connection = await ctx.integration.connection.active(PROVIDER_ID);
          const credential = connection
            ? await ctx.integration.connection.resolve(connection)
            : undefined;
          if (credential?.type === "oauth") accessToken = credential.access;
        }
        if (!accessToken) {
          throw new Error("未登录 CodeBuddy，请先执行 `opencode auth login codebuddy`");
        }

        const body = (await original.clone().json()) as OpenAIRequest;
        const resolvedModel = resolveModel(body.model);
        if (!resolvedModel) {
          throw new Error(
            "未设置模型，请设置 CODEBUDDY_DEFAULT_MODEL 或在 OpenCode 选择模型",
          );
        }

        event.request = new Request(original, {
          method: "POST",
          headers: buildAuthHeaders(accessToken, resolvedModel),
          body: JSON.stringify({
            ...body,
            model: resolvedModel,
            stream: true,
          }),
        });
      },
      { providerID: PROVIDER_ID },
    );

    await ctx.session.hook(
      "http.response",
      (event) => {
        event.response = normalizeSseResponse(event.response);
      },
      { providerID: PROVIDER_ID },
    );

    // Re-discover models when the CodeBuddy credential (or an integration
    // connection) changes at this location.
    const controller = new AbortController();
    const locationDirectory = ctx.location.directory;
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (event.type !== "credential.updated" && event.type !== "credential.switched") {
          continue;
        }
        if (event.location?.directory && event.location.directory !== locationDirectory) {
          continue;
        }
        if (
          event.type === "credential.switched" &&
          event.data.integrationID !== PROVIDER_ID
        ) {
          continue;
        }
        currentModels = await refreshModelSource(ctx);
        await ctx.provider.reload();
      }
    })();

    return () => controller.abort();
  },
});