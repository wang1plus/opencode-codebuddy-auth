import { CONFIG, DEFAULT_ENVIRONMENT, } from "./config.js";
export function generateUuid() {
    if (globalThis.crypto?.randomUUID)
        return globalThis.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
export function generateTraceId() {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
export function decodeJwtPayload(token) {
    try {
        const parts = token.split(".");
        if (parts.length < 2)
            return null;
        const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const pad = "=".repeat((4 - (payload.length % 4)) % 4);
        return JSON.parse(Buffer.from(payload + pad, "base64").toString("utf8"));
    }
    catch {
        return null;
    }
}
export function resolveTenantId(accessToken) {
    if (CONFIG.tenantId)
        return CONFIG.tenantId;
    const p = decodeJwtPayload(accessToken);
    if (!p)
        return "";
    const iss = p.iss || "";
    const m = iss.match(/realms\/sso-([^/]+)$/);
    return p.tenant_id || p.tenantId || (m?.[1] || "");
}
export function resolveEnterpriseId(accessToken) {
    if (CONFIG.enterpriseId)
        return CONFIG.enterpriseId;
    const p = decodeJwtPayload(accessToken);
    if (!p)
        return "";
    const roles = p.realm_access?.roles || p.resource_access?.account?.roles;
    if (roles) {
        for (const r of roles) {
            const m = r.match(/group-admin:([A-Za-z0-9-]+)/);
            if (m?.[1])
                return m[1];
        }
    }
    return p.enterprise_id || p.enterpriseId || p.ent_id || p.entId || "";
}
export function resolveUserId(accessToken) {
    if (CONFIG.userId)
        return CONFIG.userId;
    const p = decodeJwtPayload(accessToken);
    return p?.user_id || p?.userId || p?.uid || p?.sub || "";
}
export function resolveModel(inputModel) {
    if (CONFIG.defaultModel)
        return CONFIG.defaultModel;
    return inputModel || "";
}
export function buildAuthHeaders(accessToken, modelId, environment = DEFAULT_ENVIRONMENT) {
    const tenantId = resolveTenantId(accessToken);
    const enterpriseId = resolveEnterpriseId(accessToken);
    const userId = resolveUserId(accessToken);
    const conversationId = generateTraceId();
    const messageId = generateTraceId();
    const traceId = generateTraceId();
    const spanId = generateTraceId().slice(0, 16);
    const parentSpanId = generateTraceId().slice(0, 16);
    const headers = {
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
        "X-Domain": environment.domain,
        "X-Product": CONFIG.product,
        "User-Agent": `${CONFIG.ideName}/${CONFIG.ideVersion} CodeBuddy/${CONFIG.appVersion}`,
        b3: `${traceId}-${spanId}-1-${parentSpanId}`,
        "X-B3-TraceId": traceId,
        "X-B3-ParentSpanId": parentSpanId,
        "X-B3-SpanId": spanId,
        "X-B3-Sampled": "1",
    };
    if (tenantId)
        headers["X-Tenant-Id"] = tenantId;
    if (enterpriseId)
        headers["X-Enterprise-Id"] = enterpriseId;
    if (userId)
        headers["X-User-Id"] = userId;
    if (modelId)
        headers["X-Model-ID"] = modelId;
    return headers;
}
export function normalizeSseLine(line) {
    const carriageReturn = line.endsWith("\r") ? "\r" : "";
    const content = carriageReturn ? line.slice(0, -1) : line;
    const match = /^(\s*data:\s*)(.+)$/.exec(content);
    if (!match || match[2] === "[DONE]")
        return line;
    try {
        const data = JSON.parse(match[2]);
        if (!data || typeof data !== "object")
            return line;
        const choices = data.choices;
        if (!Array.isArray(choices))
            return line;
        let changed = false;
        for (const choice of choices) {
            if (!choice || typeof choice !== "object")
                continue;
            const delta = choice.delta;
            if (!delta || typeof delta !== "object" || Array.isArray(delta))
                continue;
            const record = delta;
            if (Array.isArray(record.tool_calls) && record.tool_calls.length === 0) {
                delete record.tool_calls;
                changed = true;
            }
        }
        if (!changed)
            return line;
        return `${match[1]}${JSON.stringify(data)}${carriageReturn}`;
    }
    catch {
        return line;
    }
}
export function normalizeSseResponse(response) {
    if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
        return response;
    }
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    const body = response.body.pipeThrough(new TransformStream({
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
            if (buffer)
                controller.enqueue(encoder.encode(normalizeSseLine(buffer)));
        },
    }));
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export async function requestAuthState(environment) {
    const params = new URLSearchParams({ platform: CONFIG.platform, ioa: "1" });
    const response = await fetch(`${environment.serverUrl}/v2/plugin/auth/state?${params.toString()}`, {
        method: "POST",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-No-Authorization": "true",
            "X-No-User-Id": "true",
            "X-No-Enterprise-Id": "true",
            "X-No-Department-Info": "true",
        },
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Auth state request failed: ${response.status} - ${text}`);
    }
    const data = (await response.json());
    if (data.code !== 0 || !data.data?.state) {
        throw new Error(`Invalid auth state response: ${JSON.stringify(data)}`);
    }
    const loginUrl = data.data.authUrl ||
        `${environment.serverUrl}/login?platform=${CONFIG.platform}&state=${data.data.state}&ioa=1`;
    return { state: data.data.state, url: loginUrl };
}
export async function pollForToken(state, expiresAt, environment, signal) {
    while (Date.now() < expiresAt) {
        if (signal?.aborted)
            return null;
        await sleep(3000);
        try {
            const response = await fetch(`${environment.serverUrl}/v2/plugin/auth/token?state=${state}`, {
                method: "GET",
                headers: {
                    Accept: "application/json",
                    "X-No-Authorization": "true",
                    "X-No-User-Id": "true",
                    "X-No-Enterprise-Id": "true",
                    "X-No-Department-Info": "true",
                },
                signal,
            });
            if (response.ok) {
                const data = (await response.json());
                if (data.code === 0 && data.data?.accessToken)
                    return data.data;
            }
        }
        catch {
            if (signal?.aborted)
                return null;
        }
    }
    return null;
}
export async function refreshAccessToken(refreshToken, environment) {
    try {
        const response = await fetch(`${environment.serverUrl}/v2/plugin/auth/token/refresh`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `Bearer ${refreshToken}`,
            },
        });
        if (!response.ok)
            return null;
        const data = (await response.json());
        if (data.code !== 0)
            return null;
        return data.data || null;
    }
    catch {
        return null;
    }
}
