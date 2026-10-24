import { Integration, Plugin, Provider, } from "@opencode/plugin";
import { buildAuthHeaders, normalizeSseResponse, pollForToken, refreshAccessToken, requestAuthState, resolveModel, } from "./auth.js";
import { PROVIDER_ID, PROVIDER_PACKAGE, resolveEnvironment, } from "./config.js";
import { fetchCredits } from "./credits.js";
import { defaultModelInfo, fetchRemoteModelsWithTimeout, remoteModelToInfo, } from "./models.js";
import { creditsRpc } from "./rpc.js";
const PROVIDER_ID_MAKE = Provider.ID.make(PROVIDER_ID);
const AUTH_METHOD_ID = "ioa";
async function resolveCurrentAccessToken(ctx) {
    try {
        const connection = await ctx.integration.connection.active(PROVIDER_ID);
        if (!connection)
            return "";
        const credential = await ctx.integration.connection.resolve(connection);
        if (!credential)
            return "";
        if (credential.type === "oauth")
            return credential.access;
        if (credential.type === "key")
            return credential.key;
        return "";
    }
    catch {
        return "";
    }
}
async function refreshModelSource(ctx, environment) {
    const token = await resolveCurrentAccessToken(ctx);
    if (!token)
        return [defaultModelInfo(PROVIDER_ID_MAKE)];
    try {
        const discovered = await fetchRemoteModelsWithTimeout(token, environment);
        return discovered.length > 0
            ? discovered.map((model) => remoteModelToInfo(model, PROVIDER_ID_MAKE))
            : [defaultModelInfo(PROVIDER_ID_MAKE)];
    }
    catch {
        return [defaultModelInfo(PROVIDER_ID_MAKE)];
    }
}
export default Plugin.define({
    id: "codebuddy-auth",
    async setup(ctx) {
        const integrationID = Integration.ID.make(PROVIDER_ID);
        // The edition (CN vs international) is inferred from the provider's
        // `settings.baseURL`; it changes whenever the user switches baseURL.
        let environment = resolveEnvironment(typeof ctx.options?.baseURL === "string" ? ctx.options.baseURL : undefined);
        // The TUI cannot read the OAuth credential directly; expose credits over
        // the plugin RPC channel instead. Register before model discovery so the
        // balance panel is not blocked by `/v3/config`.
        await ctx.rpc.register(creditsRpc, {
            credits: async () => {
                const token = await resolveCurrentAccessToken(ctx);
                if (!token) {
                    return {
                        ok: false,
                        totalRemain: 0,
                        totalUsed: 0,
                        totalSize: 0,
                        usedPercent: 0,
                        packCount: 0,
                        livePackCount: 0,
                        expiresAt: null,
                        error: "未登录 CodeBuddy，请先执行 `opencode auth login codebuddy`",
                    };
                }
                return fetchCredits(token, environment);
            },
        });
        // Current discovered model inventory. Captured by the provider transform
        // and refreshed (then replayed via `ctx.provider.reload()`) after the
        // credential changes or the user (re)connects.
        let currentModels = await refreshModelSource(ctx, environment);
        await ctx.provider.transform((editor) => {
            const injected = new Set(currentModels.map((model) => model.id));
            const existing = editor.get(PROVIDER_ID);
            if (!existing) {
                editor.add({
                    info: {
                        ...Provider.Info.empty(PROVIDER_ID_MAKE),
                        name: "CodeBuddy",
                        activation: "enabled",
                        package: PROVIDER_PACKAGE,
                        integrationID,
                        settings: { baseURL: `${environment.serverUrl}/v2` },
                    },
                    models: currentModels,
                });
                return;
            }
            // A user-declared `providers.codebuddy` block is honored: keep its
            // baseURL (environment switch), fill in the runtime package when it was
            // omitted, and never overwrite user-declared models.
            editor.update(PROVIDER_ID, (provider) => {
                if (!provider.package)
                    provider.package = PROVIDER_PACKAGE;
                if (!provider.integrationID)
                    provider.integrationID = integrationID;
                const baseURL = provider.settings?.baseURL;
                if (typeof baseURL === "string" && baseURL) {
                    environment = resolveEnvironment(baseURL);
                }
            });
            const declared = [...existing.models.values()].filter((model) => !injected.has(model.id));
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
                    const authState = await requestAuthState(environment);
                    const expiresAt = Date.now() + 10 * 60 * 1000;
                    const callback = pollForToken(authState.state, expiresAt, environment).then((tokenData) => {
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
                    });
                    return {
                        url: authState.url,
                        instructions: "请在浏览器中完成 IOA 登录",
                        mode: "auto",
                        callback,
                    };
                },
                async refresh(credential) {
                    if (!credential.refresh)
                        return credential;
                    const refreshed = await refreshAccessToken(credential.refresh, environment);
                    if (!refreshed?.accessToken)
                        return credential;
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
        await ctx.session.hook("http.request", async (event) => {
            const original = event.request;
            // The core injects the OAuth access token as a bearer credential before
            // this hook runs. Fall back to resolving it ourselves when absent.
            let accessToken = original.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
            if (!accessToken)
                accessToken = await resolveCurrentAccessToken(ctx);
            if (!accessToken) {
                throw new Error("未登录 CodeBuddy，请先执行 `opencode auth login codebuddy`");
            }
            const body = (await original.clone().json());
            const resolvedModel = resolveModel(body.model);
            if (!resolvedModel) {
                throw new Error("未设置模型，请设置 CODEBUDDY_DEFAULT_MODEL 或在 OpenCode 选择模型");
            }
            event.request = new Request(original, {
                method: "POST",
                headers: buildAuthHeaders(accessToken, resolvedModel, environment),
                body: JSON.stringify({
                    ...body,
                    model: resolvedModel,
                    stream: true,
                }),
            });
        }, { providerID: PROVIDER_ID });
        await ctx.session.hook("http.response", (event) => {
            event.response = normalizeSseResponse(event.response);
        }, { providerID: PROVIDER_ID });
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
                if (event.type === "credential.switched" &&
                    event.data.integrationID !== PROVIDER_ID) {
                    continue;
                }
                currentModels = await refreshModelSource(ctx, environment);
                await ctx.provider.reload();
            }
        })();
        return () => controller.abort();
    },
});
