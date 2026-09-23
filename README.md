# opencode-codebuddy-auth

OpenCode v2 插件，用于 CodeBuddy (IOA) 认证。通过浏览器 OAuth 登录后，可在 OpenCode 中使用 CodeBuddy 的对话模型。支持自动从 `/v3/config` 动态获取 craft agent 可用模型列表，支持国内版和国际版切换，并提供 TUI 侧边栏模型目录。

<p align="center">
  <img src="images/tui-sidebar.png" width="70%" alt="OpenCode 中的 CodeBuddy TUI 侧边栏" />
</p>

> **V2 版本**：本插件基于 OpenCode v2（`@opencode/plugin`，`Plugin.define` + Promise API）。V1 插件（config/auth/loader hooks）不会被 v2 宿主加载。

## 安装

在 `opencode.json`（项目 `.opencode/opencode.json` 或全局 `~/.config/opencode/opencode.jsonc`）中添加插件即可：

```jsonc
{
  "plugins": ["opencode-codebuddy-auth"]
}
```

或使用命令安装（会自动写入 `plugins` 并安装依赖）：

```bash
opencode plugin add opencode-codebuddy-auth
```

### 三种配置方式，任选其一

#### 方式一：只加插件（推荐）

不声明 provider，provider 和 models 全部由插件自动创建与发现：

```jsonc
{
  "plugins": ["opencode-codebuddy-auth"]
}
```

#### 方式二：声明 provider，自动发现 models

手动声明 provider 配置，但无需写 models（插件启动时自动注入）：

```jsonc
{
  "plugins": ["opencode-codebuddy-auth"],
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
  "plugins": ["opencode-codebuddy-auth"],
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

插件为支持推理的动态模型写入 `compatibility.reasoningField = "reasoning_content"`，并将 `/v3/config` 返回的 `reasoning.effort`（新格式回退 `reasoning.defaultEffort`）与 `reasoning.summary` 分别写入模型 `settings.reasoningEffort` 和 `body.reasoning_summary`。请求经 fetch 拦截器发送到 CodeBuddy。

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
  "plugins": ["opencode-codebuddy-auth"],
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

TUI 侧边栏展示 craft agent 最终可用的 CodeBuddy 模型目录（默认折叠，点击标题展开）。将鼠标移到模型名称上时显示详情（推理/工具/图片/上下文/输出限制）。基于 v2 `ui.slot` 渲染，不跟踪当前选择。

使用 `opencode plugin add` 安装后 TUI 会自动启用（写入 `tui.json` 的 `plugin` 数组）。也可手动配置，在 `~/.config/opencode/tui.json`（或项目 `.opencode/tui.json`）加入：

```json
{
  "plugin": ["opencode-codebuddy-auth"]
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
  │           （未登录或失败 fallback 为 auto；不覆盖用户手动声明的 models）
  ├─ setup → ctx.integration.transform
  │           注册 "ioa" oauth 方法（浏览器 IOA 登录 → 轮询 token；
  │           refresh 由宿主的 credential 刷新流程自动调用）
  ├─ ctx.session.hook("http.request", …, { providerID: "codebuddy" })
  │           拼接认证 headers（Authorization, B3 追踪, X-Model-ID 等）
  │           改写 body（model + stream: true）后转发到 CodeBuddy
  ├─ ctx.session.hook("http.response", …)
  │           规范化空 tool_calls 后透传 OpenAI 兼容 SSE 响应
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
npm run build   # tsc 编译到 dist/ + esbuild 打包 TUI (dist/tui.js)
```

### 本地加载（v2.0.14 注意事项）

v2.0.14 的插件加载仅支持 npm registry 或 git spec，`file://` 与 `.opencode/plugin.ts` 写法在该版本不会加载。本地联调有两种方式：

1. 将构建产物替换到已解析的缓存包：
   `~/.cache/opencode/npm/opencode-codebuddy-auth@latest/<ts>/node_modules/opencode-codebuddy-auth/`
   （把 `dist/` 与 `package.json` 覆盖进去，并在该包下补 `node_modules/@opencode/plugin` 依赖）
2. 发布到本地 npm registry 后 `opencode plugin add`。

修改源码后重新构建并完全退出重启 OpenCode：

```bash
npm run build
opencode
```

## 许可证

MIT