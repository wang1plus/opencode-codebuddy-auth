import { Model, Provider } from "@opencode/plugin";
import { type CodeBuddyEnvironment } from "./config.js";
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
        daily?: Array<{
            start: string;
            end: string;
        }>;
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
        agents?: Array<{
            name: string;
            models?: string[];
        }>;
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
export type DeepMutable<A> = A extends null | undefined | boolean | number | bigint | string | symbol | ((...args: never[]) => unknown) ? A : A extends ReadonlyArray<infer I> ? Array<DeepMutable<I>> : A extends ReadonlyMap<infer K, infer V> ? Map<DeepMutable<K>, DeepMutable<V>> : A extends object ? {
    -readonly [K in keyof A]: DeepMutable<A[K]>;
} : A;
export type MutableInfo = DeepMutable<Model.Info>;
export declare const DEFAULT_MODEL: RemoteModel;
export declare function formatCredits(credits?: string | null): string | undefined;
export declare function remoteBadgeLabel(badge?: RemoteModelBadge | null): string | undefined;
export declare function remoteHoverText(hover?: RemoteModelHover | null): string | undefined;
export declare function modelTierBadgeColor(tier?: string): string | undefined;
export declare function isPromotionActive(promotion: RemoteModelPromotion, now?: Date): boolean;
/**
 * Turn a `/v3/config` payload into the craft agent's model inventory,
 * applying tier/promotion badges and dropping models that cannot call tools.
 */
export declare function parseRemoteModels(body: RemoteConfigResponse): RemoteModel[];
export declare function remoteModelToInfo(m: RemoteModel, providerID: Provider.ID): Model.Info;
export declare function defaultModelInfo(providerID: Provider.ID): Model.Info;
export declare function fetchRemoteModels(accessToken: string, environment: CodeBuddyEnvironment): Promise<RemoteModel[]>;
export declare function fetchRemoteModelsWithTimeout(accessToken: string, environment: CodeBuddyEnvironment, timeoutMs?: number): Promise<RemoteModel[]>;
