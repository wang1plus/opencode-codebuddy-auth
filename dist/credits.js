import { billingBase, billingDomain, CONFIG, CREDITS_PRODUCT_CODE, } from "./config.js";
import { resolveEnterpriseId, resolveUserId, } from "./auth.js";
const EMPTY_SUMMARY = {
    ok: false,
    totalRemain: 0,
    totalUsed: 0,
    totalSize: 0,
    usedPercent: 0,
    packCount: 0,
    livePackCount: 0,
    expiresAt: null,
};
export function num(value, fallback = 0) {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
/** `YYYY-MM-DD HH:mm:ss` in Asia/Shanghai (billing API expects CST). */
export function formatCstDateTime(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value ?? "00";
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}
function parseCycleEnd(value) {
    if (typeof value !== "string" || !value)
        return null;
    const iso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(value)
        ? `${value.replace(" ", "T")}+08:00`
        : value;
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function parseDeductionEnd(value) {
    const ms = num(value);
    if (ms <= 0)
        return null;
    const parsed = new Date(ms);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
/**
 * Resolve one package's (remain, used, size), mirroring the CodeBuddy
 * plugin's precedence: cycle counters first, then capacity counters.
 */
export function packageRemainUsed(pkg) {
    const cycleSize = num(pkg.CycleCapacitySize);
    if (cycleSize > 0) {
        let remain = Math.max(num(pkg.CycleCapacityRemain), 0);
        remain = Math.min(remain, cycleSize);
        let used = cycleSize - remain;
        const explicitUsed = num(pkg.CycleCapacityUsed);
        if (explicitUsed > used) {
            used = explicitUsed;
            if (cycleSize >= used)
                remain = cycleSize - used;
        }
        return { remain, used, size: cycleSize };
    }
    const cycleRemain = num(pkg.CycleCapacityRemain);
    const cycleUsed = num(pkg.CycleCapacityUsed);
    if (cycleRemain > 0 || cycleUsed > 0) {
        let remain = Math.max(cycleRemain, 0);
        let used = Math.max(cycleUsed, 0);
        let size = remain + used;
        const capSize = num(pkg.CapacitySize);
        if (capSize > size) {
            size = capSize;
            if (size >= remain)
                used = size - remain;
        }
        return { remain, used, size };
    }
    let remain = Math.max(num(pkg.CapacityRemain), 0);
    let used = Math.max(num(pkg.CapacityUsed), 0);
    let size = num(pkg.CapacitySize);
    if (size <= 0)
        size = remain + used;
    if (used === 0 && size > remain)
        used = size - remain;
    return { remain, used, size };
}
/** Unwrap `{ Response: { Data: { Accounts } } }` variants. */
export function parseCreditsResponse(data) {
    const envelope = (data ?? {});
    const response = envelope.Response && typeof envelope.Response === "object"
        ? envelope.Response
        : envelope;
    const payload = response.Data && typeof response.Data === "object"
        ? response.Data
        : response;
    const accounts = Array.isArray(payload.Accounts)
        ? payload.Accounts
        : [];
    return { accounts, payload };
}
export function summarizeCredits(accounts, payload = {}) {
    let totalRemain = 0;
    let totalUsed = 0;
    let totalSize = 0;
    const liveEnds = [];
    for (const pkg of accounts) {
        if (!pkg || typeof pkg !== "object")
            continue;
        const { remain, used, size } = packageRemainUsed(pkg);
        totalRemain += remain;
        totalUsed += used;
        totalSize += size;
        if (remain > 0) {
            const when = parseCycleEnd(pkg.CycleEndTime) ?? parseDeductionEnd(pkg.DeductionEndTime);
            if (when)
                liveEnds.push(when);
        }
    }
    if (totalSize > 0) {
        totalUsed = Math.max(totalUsed, Math.max(totalSize - totalRemain, 0));
    }
    const dosage = num(payload.TotalDosage);
    if (dosage > totalSize) {
        totalSize = dosage;
        totalUsed = Math.max(totalUsed, Math.max(totalSize - totalRemain, 0));
    }
    const usedPercent = totalSize > 0 ? (totalUsed / totalSize) * 100 : 0;
    const expiresAt = liveEnds.length
        ? new Date(Math.min(...liveEnds.map((date) => date.getTime()))).toISOString()
        : null;
    return {
        ok: true,
        totalRemain: Math.round(totalRemain),
        totalUsed: Math.round(totalUsed),
        totalSize: Math.round(totalSize),
        usedPercent: Math.round(usedPercent * 100) / 100,
        packCount: accounts.length,
        livePackCount: liveEnds.length,
        expiresAt,
    };
}
/** GET/POST the billing meter endpoint and aggregate the active packages. */
export async function fetchCredits(accessToken, environment, signal) {
    const enterpriseId = resolveEnterpriseId(accessToken);
    const headers = {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-Domain": billingDomain(environment),
        "User-Agent": `${CONFIG.ideName}/${CONFIG.ideVersion} CodeBuddy/${CONFIG.appVersion}`,
    };
    const userId = resolveUserId(accessToken);
    if (userId)
        headers["X-User-Id"] = userId;
    if (enterpriseId) {
        headers["X-Enterprise-Id"] = enterpriseId;
        headers["X-Tenant-Id"] = enterpriseId;
    }
    const body = {
        PageNumber: 1,
        PageSize: 100,
        ProductCode: CREDITS_PRODUCT_CODE,
        Status: [0, 3],
        PackageEndTimeRangeBegin: formatCstDateTime(),
        PackageEndTimeRangeEnd: "2126-12-31 23:59:59",
    };
    try {
        const response = await fetch(`${billingBase(environment)}/v2/billing/meter/get-user-resource`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: signal ?? AbortSignal.timeout(8000),
        });
        const text = await response.text();
        if (!response.ok) {
            return { ...EMPTY_SUMMARY, error: `HTTP ${response.status}: ${text.slice(0, 160)}` };
        }
        let envelope;
        try {
            envelope = JSON.parse(text);
        }
        catch {
            return { ...EMPTY_SUMMARY, error: "积分接口返回了非 JSON 响应" };
        }
        const record = (envelope ?? {});
        const code = num(record.code);
        if (record.code !== undefined && code !== 0) {
            const message = typeof record.msg === "string" ? record.msg : "";
            return { ...EMPTY_SUMMARY, error: `积分接口错误 code=${code}${message ? `: ${message}` : ""}` };
        }
        const { accounts, payload } = parseCreditsResponse(record.data ?? envelope);
        return summarizeCredits(accounts, payload);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            ...EMPTY_SUMMARY,
            error: signal?.aborted ? "积分请求超时" : message || "积分请求失败",
        };
    }
}
