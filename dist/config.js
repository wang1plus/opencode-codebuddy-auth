export const PROVIDER_ID = "codebuddy";
export const AUTH_METHOD_ID = "ioa";
export const PROVIDER_PACKAGE = "@opencode/ai/providers/openai-compatible";
export const CONFIG = {
    platform: "VSCode",
    appVersion: "4.9.29177644",
    ideName: "VSCode",
    ideType: "VSCode",
    ideVersion: "1.119.0",
    product: "SaaS",
    agentIntent: "craft",
    envId: "production",
    chatCompletionsPath: "/v2/chat/completions",
    tenantId: process.env.CODEBUDDY_TENANT_ID || "",
    enterpriseId: process.env.CODEBUDDY_ENTERPRISE_ID || "",
    userId: process.env.CODEBUDDY_USER_ID || "",
    defaultModel: process.env.CODEBUDDY_DEFAULT_MODEL || "",
};
export const DEFAULT_SERVER_URL = "https://copilot.tencent.com";
export const DEFAULT_DOMAIN = "www.codebuddy.cn";
export const DISCOVERY_TIMEOUT_MS = 5000;
/** Billing (credits) endpoints live on the public site, not the API host. */
export const BILLING_BASE_CN = "https://www.codebuddy.cn";
export const BILLING_BASE_GLOBAL = "https://www.workbuddy.ai";
export const CREDITS_PRODUCT_CODE = "p_tcaca";
export const DEFAULT_ENVIRONMENT = {
    serverUrl: DEFAULT_SERVER_URL,
    domain: DEFAULT_DOMAIN,
};
/**
 * Derive the API host and `X-Domain` header from a configured
 * `settings.baseURL` (the only place an edition switch is stored).
 */
export function resolveEnvironment(baseURL) {
    if (!baseURL)
        return { ...DEFAULT_ENVIRONMENT };
    try {
        const url = new URL(baseURL);
        const serverUrl = `${url.protocol}//${url.host}`;
        return {
            serverUrl,
            domain: serverUrl.includes("codebuddy.ai") || serverUrl.includes("workbuddy.ai")
                ? "www.codebuddy.ai"
                : DEFAULT_DOMAIN,
        };
    }
    catch {
        return { ...DEFAULT_ENVIRONMENT };
    }
}
/** International editions bill through workbuddy.ai. */
export function billingBase(environment) {
    return environment.domain.endsWith("codebuddy.ai")
        ? BILLING_BASE_GLOBAL
        : BILLING_BASE_CN;
}
/** Billing uses its own `X-Domain` value for the international edition. */
export function billingDomain(environment) {
    return environment.domain.endsWith("codebuddy.ai") ? "workbuddy.ai" : DEFAULT_DOMAIN;
}
