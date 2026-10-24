export declare const PROVIDER_ID = "codebuddy";
export declare const AUTH_METHOD_ID = "ioa";
export declare const PROVIDER_PACKAGE = "@opencode/ai/providers/openai-compatible";
export declare const CONFIG: {
    platform: string;
    appVersion: string;
    ideName: string;
    ideType: string;
    ideVersion: string;
    product: string;
    agentIntent: string;
    envId: string;
    chatCompletionsPath: string;
    tenantId: string;
    enterpriseId: string;
    userId: string;
    defaultModel: string;
};
export declare const DEFAULT_SERVER_URL = "https://copilot.tencent.com";
export declare const DEFAULT_DOMAIN = "www.codebuddy.cn";
export declare const DISCOVERY_TIMEOUT_MS = 5000;
/** Billing (credits) endpoints live on the public site, not the API host. */
export declare const BILLING_BASE_CN = "https://www.codebuddy.cn";
export declare const BILLING_BASE_GLOBAL = "https://www.workbuddy.ai";
export declare const CREDITS_PRODUCT_CODE = "p_tcaca";
export interface CodeBuddyEnvironment {
    serverUrl: string;
    domain: string;
}
export declare const DEFAULT_ENVIRONMENT: CodeBuddyEnvironment;
/**
 * Derive the API host and `X-Domain` header from a configured
 * `settings.baseURL` (the only place an edition switch is stored).
 */
export declare function resolveEnvironment(baseURL?: string): CodeBuddyEnvironment;
/** International editions bill through workbuddy.ai. */
export declare function billingBase(environment: CodeBuddyEnvironment): string;
/** Billing uses its own `X-Domain` value for the international edition. */
export declare function billingDomain(environment: CodeBuddyEnvironment): string;
