import { type CodeBuddyEnvironment } from "./config.js";
export interface CreditsSummary {
    ok: boolean;
    /** Remaining credits across every active package. */
    totalRemain: number;
    totalUsed: number;
    totalSize: number;
    usedPercent: number;
    packCount: number;
    livePackCount: number;
    /** Earliest expiry of a package that still has credits (ISO 8601). */
    expiresAt: string | null;
    error?: string;
}
export declare function num(value: unknown, fallback?: number): number;
/** `YYYY-MM-DD HH:mm:ss` in Asia/Shanghai (billing API expects CST). */
export declare function formatCstDateTime(date?: Date): string;
/**
 * Resolve one package's (remain, used, size), mirroring the CodeBuddy
 * plugin's precedence: cycle counters first, then capacity counters.
 */
export declare function packageRemainUsed(pkg: Record<string, unknown>): {
    remain: number;
    used: number;
    size: number;
};
/** Unwrap `{ Response: { Data: { Accounts } } }` variants. */
export declare function parseCreditsResponse(data: unknown): {
    accounts: Array<Record<string, unknown>>;
    payload: Record<string, unknown>;
};
export declare function summarizeCredits(accounts: Array<Record<string, unknown>>, payload?: Record<string, unknown>): CreditsSummary;
/** GET/POST the billing meter endpoint and aggregate the active packages. */
export declare function fetchCredits(accessToken: string, environment: CodeBuddyEnvironment, signal?: AbortSignal): Promise<CreditsSummary>;
