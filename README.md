# opencode-codebuddy-auth

OpenCode v2 插件，用于 CodeBuddy (IOA) 认证。通过浏览器 OAuth 登录后，可在 OpenCode 中使用 CodeBuddy 的对话模型。支持自动从 `/v3/config` 动态获取 craft agent 可用模型列表、推理强度 variants、积分余额查询，以及国内版和国际版切换。

> **V2 版本**：本插件基于 OpenCode v2（`@opencode/plugin`，`Plugin.define` + Promise API）。V1 插件（config/auth/loader hooks）不会被 v2 宿主加载。

## 安装

本插件通过 Git 仓库安装，源码托管在 <https://github.com/wang1plus/opencode-codebuddy-auth>。

在 `opencode.json`（项目 `.opencode/opencode.json` 或全局 `~/.config/opencode/opencode.jsonc`）中添加插件即可：

```jsonc
{
  "plugins": ["github:wang1plus/opencode-codebuddy-auth"]
}
```

或使用命令安装（会自动写入 `plugins` 并安装依赖）：

```bash
opencode plugin add github:wang1plus/opencode-codebuddy-auth
```

默认跟随仓库默认分支（`main`）更新，服务器启动时会自动检查更新；如需固定版本，可追加 `#<分支|标签|commit>`，例如 `github:wang1plus/opencode-codebuddy-auth#v2.0.1`。手动更新已安装的插件：

```bash
opencode plugin update github:wang1plus/opencode-codebuddy-auth
```

### 三种配置方式，任选其一

#### 方式一：只加插件（推荐）

不声明 provider，provider 和 models 全部由插件自动创建与发现：

```jsonc
{
  "plugins": ["github:wang1plus/opencode-codebuddy-auth"]
}
```

#### 方式二：声明 provider，自动发现 models

手动声明 provider 配置，但无需写 models（插件启动时自动注入）：

```jsonc
{
  "plugins": ["github:wang1plus/opencode-codebuddy-auth"],
  "providers": {
    "codebuddy": {
      "package": "@opencode/ai/providers/openai-compatible",
      "name": "CodeBuddy",
      "settings": {
        "baseURL": "https://copilot.tencent.com/v2"
      }
    }
  }
}
```

#### 方式三：手动声明 models

完全手动控制模型列表，插件不会覆盖已有条目，仅在缺失时补充发现到的模型：

```jsonc
{
  "plugins": ["github:wang1plus/opencode-codebuddy-auth"],
  "providers": {
    "codebuddy": {
      "package": "@opencode/ai/providers/openai-compatible",
      "name": "CodeBuddy",
      "settings": {
        "baseURL": "https://copilot.tencent.com/v2"
      },
      "models": {
        "auto": { "name": "Auto", "limit": { "context": 168000, "output": 32000 } },
        "kimi-k3-1": { "name": "Kimi-K3", "limit": { "context": 1000000, "output": 32000 } }
      }
    }
  }
}
```

> 插件启动时通过 provider transform 创建/补充 `providers.codebuddy`，并调用 `GET /v3/config` 动态获取 craft agent 可用模型注入到 `models`。未登录或获取失败时 fallback 为 `auto` 默认模型。手动声明的模型永远优先，不会被覆盖。

## 安装故障排查

### `git dep preparation failed`

OpenCode 2.1.4 内置的 npm 在准备 git 依赖时会错误地再次调用自身（日志中表现为 `CliError/ShowHelp`），与网络无关。绕过方式是先用系统 npm 把插件装进 OpenCode 的缓存目录，再手动添加配置：

```bash
# 先执行一次 opencode plugin add，让 OpenCode 创建缓存目录（会失败）
opencode plugin add github:wang1plus/opencode-codebuddy-auth

BASE=$(ls -d ~/.cache/opencode/npm/git-opencode-codebuddy-auth-* | head -1)
TS=$(node -e 'console.log(Date.now())')
mkdir -p "$BASE/$TS" && cd "$BASE/$TS"
printf '{"dependencies":{"opencode-codebuddy-auth":"github:wang1plus/opencode-codebuddy-auth"}}\n' > package.json
npm install --no-audit --no-fund
```

然后在 `~/.config/opencode/opencode.jsonc` 的 `plugins` 与 `~/.config/opencode/cli.json` 的 `plugins` 中加入该插件，重启 OpenCode。

## 登录

```bash
opencode auth login codebuddy
```

浏览器会打开 IOA 登录页面，完成后 token 自动保存到本地数据库（由插件注册的 `ioa` oauth 方法管理；`opencode auth list` 可查看已保存的账号）。

## 查看可用模型

```bash
opencode models
```

搜索 `codebuddy` 即可看到注入的模型。交互式选择：OpenCode 内输入 `/model` 搜索 codebuddy。

## 查看最终配置

登录后插件会通过 `GET /v3/config` 实时获取 craft agent 可用模型并自动注入：

```bash
opencode debug config
```

模型名称会显示接口返回的积分倍率：

- `x0.00` 显示为 `Free`，例如 `Hy3 (Free)`
- 其它值原样显示，例如 `Deepseek-V4-Pro (x0.13)`
- 未返回 `credits` 的模型保持原名称

### 推理（Reasoning）支持

插件为支持推理的动态模型写入 `compatibility.reasoningField = "reasoning_content"`，并将 `/v3/config` 返回的 `reasoning.effort`（新格式回退 `reasoning.defaultEffort`）与 `reasoning.summary` 分别写入模型 `settings.reasoningEffort` 和 `body.reasoning_summary`。

`reasoning.supportedEfforts` 会生成可切换的模型 variants（如 `low` / `medium` / `high`）；`reasoning.canDisableThinking = true` 时额外提供 `none`（关闭思考）。只支持推理的模型（`onlyReasoning`）会写入 `compatibility.requireReasoning = true`。在 OpenCode 中可通过模型 variant 选择器切换。

CodeBuddy 的 SSE reasoning chunk 会携带空的 `tool_calls: []`。OpenAI 兼容适配器会把空数组误判为工具调用开始，导致推理被拆成多个片段。插件的 `http.response` 仅删除 `choices[].delta.tool_calls` 的空数组；非空工具调用和其它字段保持不变。

命令行验证：

```bash
opencode run --model codebuddy/hy3 --format json --thinking '只回答 OK'
```

输出中应包含连续的 `"type":"reasoning"` 事件，随后是 `"type":"text"`。

### 动态获取模型列表

```bash
curl -H 'Accept: application/json, text/plain, */*' \
     -H 'X-Requested-With: XMLHttpRequest' \
     -H 'Authorization: Bearer <TOKEN>' \
     -H 'X-Domain: www.codebuddy.cn' \
     -H 'X-Product: SaaS' \
     -H 'X-IDE-Type: VSCode' \
     -H 'X-IDE-Name: VSCode' \
     -H 'X-IDE-Version: 1.119.0' \
     -H 'X-Product-Version: 4.9.29177644' \
     -H 'X-Env-ID: production' \
     -H 'User-Agent: VSCode/1.119.0 CodeBuddy/4.9.29177644' \
     'https://copilot.tencent.com/v3/config'
```

- `data.models` — 所有可用模型的详细信息
- `data.agents[].models` — craft agent 可用的模型 ID 列表

## 积分余额

余额通过 CodeBuddy 的 Billing 接口读取：

```bash
curl -X POST 'https://www.codebuddy.cn/v2/billing/meter/get-user-resource' \
  -H "Authorization: Bearer <TOKEN>" \
  -H "X-Domain: www.codebuddy.cn" \
  -H "X-User-Id: <UID>" \
  -H "X-Enterprise-Id: <ENTERPRISE_ID>" \
  -H "Content-Type: application/json" \
  -d '{"PageNumber":1,"PageSize":100,"ProductCode":"p_tcaca","Status":[0,3],"PackageEndTimeRangeBegin":"2026-01-01 00:00:00","PackageEndTimeRangeEnd":"2126-12-31 23:59:59"}'
```

`Response.Data.Accounts` 中每个套餐按 `CycleCapacity*` / `Capacity*` 计算剩余与已用量，插件汇总 `totalRemain` / `totalUsed` / `totalSize`，并取仍有余额套餐中最早的到期时间。国际版接口位于 `https://www.workbuddy.ai`（由 `baseURL` 自动选择）。

## 环境变量

通过 shell `export` 设置，普通用户无需配置（JWT 自动提取）：

```bash
# 强制使用指定模型（忽略 OpenCode 模型选择）
export CODEBUDDY_DEFAULT_MODEL=kimi-k3-1

# 覆盖企业/租户信息（不设置则从 JWT 自动提取）
export CODEBUDDY_TENANT_ID=xxx
export CODEBUDDY_ENTERPRISE_ID=xxx
export CODEBUDDY_USER_ID=xxx

opencode
```

| 变量 | 说明 | 必需 |
|------|------|------|
| `CODEBUDDY_DEFAULT_MODEL` | 强制使用指定模型（不设置则使用 OpenCode 选择的模型） | 否 |
| `CODEBUDDY_TENANT_ID` | 覆盖 tenant_id（不设置则从 JWT 自动提取） | 否 |
| `CODEBUDDY_ENTERPRISE_ID` | 覆盖 enterprise_id（不设置则从 JWT 自动提取） | 否 |
| `CODEBUDDY_USER_ID` | 覆盖 user_id（不设置则从 JWT 自动提取） | 否 |

## 国内版 vs 国际版

默认使用**国内版**。切换国际版只需修改 `baseURL`，插件会自动检测并切换 `X-Domain`：

```jsonc
{
  "plugins": ["github:wang1plus/opencode-codebuddy-auth"],
  "providers": {
    "codebuddy": {
      "settings": {
        "baseURL": "https://www.codebuddy.ai/v2"
      }
    }
  }
}
```

| 环境 | baseURL | X-Domain（自动检测） |
|------|---------|---------|
| 国内版（默认） | `https://copilot.tencent.com/v2` | `www.codebuddy.cn` |
| 国际版 | `https://www.codebuddy.ai/v2` | `www.codebuddy.ai` |

> 插件根据 `baseURL` 自动设置 `X-Domain`：检测到 `codebuddy.ai` 时使用 `www.codebuddy.ai`，否则默认 `www.codebuddy.cn`。

## TUI 侧边栏

TUI 侧边栏显示 CodeBuddy 账户的**积分余额**（默认每 5 分钟刷新，点击标题立即刷新）：

- 剩余积分与已用 / 总量
- 已用百分比进度条
- 最近一个仍有余额的套餐到期日
- 未登录或接口失败时显示原因

余额由 server 插件通过 `POST /v2/billing/meter/get-user-resource` 获取，再经插件 RPC 通道提供给 TUI；TUI 本身不接触 access token。国内版请求 `https://www.codebuddy.cn`，国际版请求 `https://www.workbuddy.ai`。

使用 `opencode plugin add` 安装后 TUI 会自动启用。手动配置时，OpenCode v2.1.4 的 TUI 插件列表位于 `~/.config/opencode/cli.json`：

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["github:wang1plus/opencode-codebuddy-auth"]
}
```

旧版本的 `~/.config/opencode/tui.json`（或项目 `.opencode/tui.json`）仍会被自动迁移：

```json
{
  "plugin": ["github:wang1plus/opencode-codebuddy-auth"]
}
```

修改配置后需要完全退出并重新启动 OpenCode。

## 工作原理

```
OpenCode v2 插件 (@opencode/plugin, Plugin.define)
  ├─ setup → ctx.provider.transform
  │           创建 providers.codebuddy（package=@opencode/ai/providers/openai-compatible,
  │           settings.baseURL=<server>/v2, integrationID=codebuddy）
  │           通过 GET /v3/config 动态发现 craft agent 可用模型，注入 models
  │           （含 reasoning variants；未登录或失败 fallback 为 auto；
  │            不覆盖用户手动声明的 models）
  ├─ setup → ctx.integration.transform
  │           注册 "ioa" oauth 方法（浏览器 IOA 登录 → 轮询 token；
  │           refresh 由宿主的 credential 刷新流程自动调用）
  ├─ ctx.session.hook("http.request", …, { providerID: "codebuddy" })
  │           拼接认证 headers（Authorization, B3 追踪, X-Model-ID 等）
  │           改写 body（model + stream: true）后转发到 CodeBuddy
  ├─ ctx.session.hook("http.response", …)
  │           规范化空 tool_calls 后透传 OpenAI 兼容 SSE 响应
  ├─ ctx.rpc.register(creditsRpc)
  │           向 TUI 暴露积分余额（内部调用 billing meter 接口）
  └─ ctx.event.subscribe
            监听 credential.updated / credential.switched（按目录 + integrationID 过滤）
            重新发现模型并 ctx.provider.reload()
```

- 凭据由宿主自动以 bearer 形式注入（provider.integrationID 关联 connection）；`http.request` 找不到时回退 `ctx.integration.connection.active/resolve` 自行解析。
- 登录/刷新后的模型重发现依赖宿主 `credential.*` 事件，无需手动重启。
- **最小 SSE 规范化** — 仅删除 `delta.tool_calls: []`，避免适配器错误拆分 reasoning；非空工具调用和其它字段保持不变。

## 开发

```bash
npm install
npm run build       # tsc 编译到 dist/ + esbuild 打包 TUI (dist/tui.js)
npm run typecheck   # 只做类型检查
npm test            # 构建后运行 node:test 测试
```

测试覆盖模型解析（含 reasoning variants）、积分汇总、JWT/请求头、SSE 规范化，以及 provider transform / RPC 的插件装配逻辑。

### CI 与发布

- `.github/workflows/ci.yml`：PR 和 main push 上跑 `typecheck` + `test`。
- `.github/workflows/release.yml`：push 到 main 后自动跑测试、升 patch 版本、重新构建 `dist/`、提交、打 `vX.Y.Z` tag 并创建 GitHub Release；也可手动触发并选择 `current` / `patch` / `minor` / `major`。不想让某次 push 发版时，在 commit message 里加 `[skip release]`（`[skip ci]` 会同时跳过 CI 和发布）。
- `dist/` 由 release 工作流维护（自动提交，release commit 带 `[skip ci]` 避免循环）。

### 本地加载（v2.0.14 注意事项）

v2.0.14 的插件加载仅支持 npm registry 或 git spec，`file://` 与 `.opencode/plugin.ts` 写法在该版本不会加载。本地联调有两种方式：

1. 将构建产物替换到已解析的缓存包，把 `dist/` 与 `package.json` 覆盖进去，并在该包下补 `node_modules/@opencode/plugin` 依赖：
   - npm 安装：`~/.cache/opencode/npm/opencode-codebuddy-auth@latest/<ts>/node_modules/opencode-codebuddy-auth/`
   - git 安装：`~/.cache/opencode/git/` 下对应的仓库缓存目录
2. 推送到 Git 仓库后 `opencode plugin add github:wang1plus/opencode-codebuddy-auth`（或发布 npm registry 后安装）。

修改源码后重新构建并完全退出重启 OpenCode：

```bash
npm run build
opencode
```

## 许可证

MIT