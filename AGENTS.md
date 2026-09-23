# AGENTS.md

## 项目概述

OpenCode v2 插件，为 CodeBuddy 提供 IOA OAuth 认证、模型发现和请求拦截。双入口：`src/index.ts`（server 插件）+ `src/tui.tsx`（TUI 侧边栏插件）。

## 构建

```bash
npm install && npm run build   # tsc 编译到 dist/ + esbuild 打包 TUI -> dist/tui.js
```

无测试、无 lint、无 CI。只有 `npm run build`。构建产物 `src/index.ts` → `dist/index.js`，`src/tui.tsx` → `dist/tui.js`（`build.tui.mjs`，external 为 `@opencode/*`、`@opentui/*`、`solid-js`）。

## 架构要点

- 基于 `@opencode/plugin` v2（Promise API）：`Plugin.define({ id, setup(ctx) })`，default export。
- V1 的 `config`/`auth`/`chat.params` hooks 与自定义 `fetch` loader 在 v2 宿主中不再运行，已真实移植为 v2 API。
- peerDependencies：`@opencode/plugin: ^2.0.0`（仅开发时安装）、`@opentui/core`、`@opentui/solid`、`solid-js`。

### 核心机制（setup(ctx)）

1. **provider.transform** — 创建/补充 `providers.codebuddy`：
   - 未声明时 `editor.add`（`package: "@opencode/ai/providers/openai-compatible"`、`activation: "auto"`、`integrationID`、`settings.baseURL: <server>/v2`）。
   - 已声明时 `editor.update`：补 `package`/`integrationID`，从 `settings.baseURL` 反推 `resolvedServerUrl`/`resolvedDomain`（环境切换）；`editor.models.set` 合并注入发现模型，用户声明的 models 优先保留。
2. **integration.transform** — 注册 `ioa` oauth 方法（`editor.method.update`，隐式创建 integration）：`authorize` 走浏览器 IOA → 轮询 token（返回 `{ url, mode: "auto", callback }`）；`refresh` 由宿主自动调用。credential 的 `methodID` 必须为 `"ioa"`。
3. **session.hook("http.request", …, { providerID })** — 重写 `event.request`：
   - 读 `authorization`（宿主注入的 bearer），缺失时回退 `ctx.integration.connection.active()/resolve()`；
   - 改写 body（`model`、`stream: true`），附加 CodeBuddy 认证 headers（B3 追踪、`X-Model-ID`、`X-Tenant-Id` 等）。
4. **session.hook("http.response", …)** — SSE 规范化：仅删除 `choices[].delta.tool_calls` 的空数组（reasoning 连续性），其余透传。
5. **event.subscribe** — 监听 `credential.updated`/`credential.switched`（按 `location.directory` + `integrationID` 过滤），重新发现模型后 `ctx.provider.reload()`。无手动 401/403 刷新。

### 模型发现

- `GET /v3/config` 获取 craft agent 可用模型（需 access token），fallback 为 `auto` 默认模型。
- token 来源：`ctx.integration.connection.active(PROVIDER_ID)` → `resolve()`（宿主 DB 存储凭据，path: `~/.local/share/opencode/opencode.db`）。
- 推理注入：`compatibility.reasoningField: "reasoning_content"`、`settings.reasoningEffort`、`body.reasoning_summary`（由 openai-chat 协议合并进请求体）。
- `Model.Info.default()` 返回只读窄类型 → 内部定义 `DeepMutable`/`MutableInfo` 类型后再赋值。

### 用户配置（三种方式）

1. 只加 `plugins`，不声明 provider（推荐，全自动）
2. 声明 `providers.codebuddy` 不声明 models（自动发现模型）
3. 手动声明 provider + models（手动优先，不覆盖）

v2 配置键：`plugins`（复数）、`providers`、provider 字段 `package`（旧 `npm`）与 `settings`（旧 `options`）。`setCacheKey` 概念已移除。

## 环境

- 国内版 API：`copilot.tencent.com`，`X-Domain: www.codebuddy.cn`（默认）
- 国际版 API：`www.codebuddy.ai`，`X-Domain: www.codebuddy.ai`
- 切换环境需改 provider `settings.baseURL`（插件自动反推 serverUrl/domain）
- 模型列表经 `GET /v3/config` 获取（需 access token），可能随时变化
- 凭据存 SQLite DB（`~/.local/share/opencode/opencode.db` 的 `credential` 表），登录命令 `opencode auth login codebuddy`

## TUI 插件（src/tui.tsx）

- 形态：`Plugin.define({ id, setup(context) })`（来自 `@opencode/plugin/tui`，由宿主注入 `{Plugin, PluginContextProvider, usePlugin}`）。
- `context.ui.slot({ append: "sidebar.context", render(input) })` 收 `{ sessionID }`；`context.theme` 是静态对象（非 signal）。
- 模型经 `context.data.location.model.sync()/list(location)`（location 取 `data.session.get(sessionID)?.location ?? context.location`）；`context.data.on("model.updated", …)` 重同步。
- setup 返回清理函数（unsub + offSlot）。无 V2 宿主字段：展示 name/limits/capabilities（reasoning/tools/images）。