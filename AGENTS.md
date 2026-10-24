# AGENTS.md

## 项目概述

OpenCode v2 插件，为 CodeBuddy 提供 IOA OAuth 认证、模型发现、请求拦截和积分余额查询。双入口：`src/index.ts`（server 插件）+ `src/tui.tsx`（TUI 侧边栏插件）。

## 构建与测试

```bash
npm install
npm run compile       # tsc 编译到 dist/ + esbuild 打包 TUI -> dist/tui.js
npm run typecheck   # 只做类型检查
npm test            # 编译后运行 node:test（test/*.test.mjs）
```

无 lint。测试通过 `dist/` 导入被测模块，因此 `npm test` 会先构建。构建产物 `src/index.ts` → `dist/index.js`，`src/tui.tsx` → `dist/tui.js`（`build.tui.mjs`，external 为 `@opencode/*`、`@opentui/*`、`solid-js`）。

CI：`.github/workflows/ci.yml`（PR/push 跑 typecheck + test）；`.github/workflows/release.yml`（push main 自动升 patch、构建 dist、提交、打 tag、发 Release，release commit 带 `[skip ci]`）。`dist/` 由 release 工作流提交，不再 gitignore。

## 模块

- `src/config.ts` — 常量、`resolveEnvironment(baseURL)`（环境切换）、billing 域名选择。
- `src/auth.ts` — JWT claims 解析、认证 headers、SSE 规范化、OAuth state/poll/refresh。
- `src/models.ts` — `/v3/config` 解析、promotion/tier、`remoteModelToInfo`（reasoning variants）。
- `src/credits.ts` — 积分 Billing 接口、套餐容量汇总。
- `src/rpc.ts` — server ↔ TUI 的 `creditsRpc` 定义（JSON Schema）。
- `src/index.ts` — 插件装配。
- `src/tui.tsx` — 积分余额面板。

## 架构要点

- 基于 `@opencode/plugin` v2（Promise API）：`Plugin.define({ id, setup(ctx) })`，default export。
- peerDependencies：`@opencode/plugin: ^2.1.4`、`@opentui/core`/`@opentui/solid: >=0.6.8`、`solid-js`；devDependencies 同步安装。

### 核心机制（setup(ctx)）

1. **provider.transform** — 创建/补充 `providers.codebuddy`：
   - 未声明时 `editor.add`（`package: "@opencode/ai/providers/openai-compatible"`、`activation: "auto"`、`integrationID`、`settings.baseURL: <server>/v2`）。
   - 已声明时 `editor.update`：补 `package`/`integrationID`，从 `settings.baseURL` 反推 environment（环境切换）；`editor.models.set` 合并注入发现模型，用户声明的 models 优先保留。
2. **integration.transform** — 注册 `ioa` oauth 方法（`editor.method.update`，隐式创建 integration）：`authorize` 走浏览器 IOA → 轮询 token（返回 `{ url, mode: "auto", callback }`）；`refresh` 由宿主自动调用。credential 的 `methodID` 必须为 `"ioa"`。
3. **session.hook("http.request", …, { providerID })** — 重写 `event.request`：
   - 读 `authorization`（宿主注入的 bearer），缺失时回退 `ctx.integration.connection.active()/resolve()`；
   - 改写 body（`model`、`stream: true`），附加 CodeBuddy 认证 headers（B3 追踪、`X-Model-ID`、`X-Tenant-Id` 等）。
4. **session.hook("http.response", …)** — SSE 规范化：仅删除 `choices[].delta.tool_calls` 的空数组（reasoning 连续性），其余透传。
5. **rpc.register(creditsRpc)** — `credits` 方法解析 access token 后调用 Billing 接口，返回汇总；TUI 通过 `context.client.rpc(creditsRpc)` 调用。
6. **event.subscribe** — 监听 `credential.updated`/`credential.switched`（按 `location.directory` + `integrationID` 过滤），重新发现模型后 `ctx.provider.reload()`。无手动 401/403 刷新。

### 模型发现

- `GET /v3/config` 获取 craft agent 可用模型（需 access token），fallback 为 `auto` 默认模型。
- token 来源：`ctx.integration.connection.active(PROVIDER_ID)` → `resolve()`（宿主 DB 存储凭据，path: `~/.local/share/opencode/opencode.db`）。
- 推理注入：`compatibility.reasoningField: "reasoning_content"`、`settings.reasoningEffort`、`body.reasoning_summary`；`supportedEfforts` + `canDisableThinking` 生成 `variants`（`none` 仅在上游允许时提供），`onlyReasoning` 写 `requireReasoning`，并设 `supportsPromptCacheKey`。
- `Model.Info.default()` 返回只读窄类型 → 内部定义 `DeepMutable`/`MutableInfo` 类型后再赋值。

### 积分余额

- `POST <billingBase>/v2/billing/meter/get-user-resource`，body 固定 `ProductCode: "p_tcaca"`、`Status: [0,3]`、CST 时间窗。
- headers：`Authorization: Bearer <access>`、`X-Domain`，JWT 可解析时补 `X-User-Id`/`X-Enterprise-Id`/`X-Tenant-Id`。
- 国内版 billing base：`https://www.codebuddy.cn`；国际版（`X-Domain` 为 codebuddy.ai）：`https://www.workbuddy.ai`。
- 汇总逻辑：每个套餐按 `CycleCapacity*` → `Capacity*` 优先级计算 remain/used/size；`TotalDosage` 可放大 size；`expiresAt` 取仍有余额套餐的最早 `CycleEndTime`/`DeductionEndTime`。

### 用户配置（三种方式）

1. 只加 `plugins`，不声明 provider（推荐，全自动）
2. 声明 `providers.codebuddy` 不声明 models（自动发现模型）
3. 手动声明 provider + models（手动优先，不覆盖）

v2 配置键：`plugins`（复数）、`providers`、provider 字段 `package`（旧 `npm`）与 `settings`（旧 `options`）。`setCacheKey` 概念已移除。

## 环境

- 国内版 API：`copilot.tencent.com`，`X-Domain: www.codebuddy.cn`（默认）
- 国际版 API：`www.codebuddy.ai`，`X-Domain: www.codebuddy.ai`
- 切换环境需改 provider `settings.baseURL`（插件自动反推 serverUrl/domain，billing 域名随之切换）
- 模型列表经 `GET /v3/config` 获取（需 access token），可能随时变化
- 凭据存 SQLite DB（`~/.local/share/opencode/opencode.db` 的 `credential` 表），登录命令 `opencode auth login codebuddy`

## TUI 插件（src/tui.tsx）

- 形态：`Plugin.define({ id, setup(context) })`（来自 `@opencode/plugin/tui`）。
- `context.ui.slot({ append: "sidebar.content", render })`；`context.theme` 是静态对象（非 signal）。
- 不再加载模型列表：通过 `context.client.rpc(creditsRpc).credits({})` 取余额，`createResource` + 5 分钟定时刷新，监听 `credential.updated`/`credential.switched` 立即刷新。
- 展示剩余积分、已用/总量、百分比进度条、最早到期日；失败时显示错误文案。
- setup 返回清理函数（offSlot）；定时器与事件监听在组件 `onCleanup` 中释放。
