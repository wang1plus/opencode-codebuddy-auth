import { type CodeBuddyEnvironment } from "./config.js";
export interface JwtPayload {
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
    realm_access?: {
        roles?: string[];
    };
    resource_access?: {
        account?: {
            roles?: string[];
        };
    };
}
export interface AuthStateResponse {
    code: number;
    data?: {
        state: string;
        authUrl?: string;
    };
}
export interface TokenPollResponse {
    code: number;
    data?: {
        accessToken: string;
        refreshToken?: string;
        expiresIn?: number;
    };
}
export interface RefreshResponse {
    code: number;
    data?: {
        accessToken: string;
        refreshToken?: string;
        expiresIn?: number;
    };
}
export interface OpenAIRequest {
    model?: string;
    stream?: boolean;
    response_format?: unknown;
    [key: string]: unknown;
}
export declare function generateUuid(): string;
export declare function generateTraceId(): string;
export declare function decodeJwtPayload(token: string): JwtPayload | null;
export declare function resolveTenantId(accessToken: string): string;
export declare function resolveEnterpriseId(accessToken: string): string;
export declare function resolveUserId(accessToken: string): string;
export declare function resolveModel(inputModel?: string): string;
export declare function buildAuthHeaders(accessToken: string, modelId?: string, environment?: CodeBuddyEnvironment): Record<string, string>;
export declare function normalizeSseLine(line: string): string;
export declare function normalizeSseResponse(response: Response): Response;
export declare function sleep(ms: number): Promise<void>;
export declare function requestAuthState(environment: CodeBuddyEnvironment): Promise<{
    state: string;
    url: string;
}>;
export declare function pollForToken(state: string, expiresAt: number, environment: CodeBuddyEnvironment, signal?: AbortSignal): Promise<TokenPollResponse["data"] | null>;
export declare function refreshAccessToken(refreshToken: string, environment: CodeBuddyEnvironment): Promise<RefreshResponse["data"] | null>;
