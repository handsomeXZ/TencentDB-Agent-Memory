# OpenCode 配置指南

## 概览

TencentDB Agent Memory 的 OpenCode v1 插件，是一个通过 HTTP 连接独立 Gateway 的长期记忆插件。

它的职责很明确：

- 连接已经运行好的 TencentDB Agent Memory Gateway。
- 为 OpenCode 提供长期记忆 capture、显式 recall/search、conversation search、session end flush。
- 在 Gateway 超时、降级或短暂不可用时，以非阻塞方式降级，而不是让 OpenCode 整体失效。

它不会做这些事情：

- 不会启动、停止、重启、安装、配置或监督 Docker。
- 不会启动或停止 Gateway。
- 不会在 OpenCode v1 中提供短期 context offload/compression。
- 不会提供 admin/debug/seed/delete/update/stats/reset 一类管理工具。

也就是说，这个插件只是 **OpenCode 侧的 Gateway 客户端**。Gateway 必须先独立部署并运行好。

## 兼容性范围

| 项目 | 值 |
| --- | --- |
| OpenCode 源码基线 | `anomalyco/opencode` `b956e9a06f2bf4e3a6ff026d0566c362f57a76b7` |
| 已验证 OpenCode 版本 | `1.15.12` |
| 已验证 `@opencode-ai/plugin` 版本 | `1.15.12` |
| 兼容性说明 | [`docs/opencode-plugin-compatibility.md`](./opencode-plugin-compatibility.md) |

本文档只对以上 commit / version 组合负责，不默认适用于其他 OpenCode 版本。

## 快速开始

完成接入只需要 4 步：

1. 启动独立 Gateway，并确认 `GET /health` 正常。
2. 在 Gateway 侧配置好非空 `TDAI_GATEWAY_API_KEY`。
3. 用 `opencode.json` 配置本插件，并通过 `apiKey` 或环境变量 `TDAI_GATEWAY_API_KEY` 提供同一个 key。
4. 启动 OpenCode，然后通过显式工具 `tdai_memory_recall`、`tdai_memory_search`、`tdai_conversation_search` 验证记忆能力。

## 前置条件

在配置前，请先确认：

1. OpenCode 版本与上面的兼容性基线一致。
2. TencentDB Agent Memory Gateway 已经独立运行，通常地址是 `http://127.0.0.1:8420`。
3. Gateway 已配置非空 `TDAI_GATEWAY_API_KEY`。
4. OpenCode 插件能拿到同一个 API key：
   - 插件配置里的 `apiKey`，或
   - 启动 OpenCode 进程时的环境变量 `TDAI_GATEWAY_API_KEY`
5. 如果你要在本地构建、打包、导入验证，Node.js 版本需要 `>=22.16.0`。

## 环境变量

| 变量名 | 必填 | 默认值 | 用途 |
| --- | --- | --- | --- |
| `TDAI_GATEWAY_API_KEY` | 是 | 无 | 受保护 Gateway 路由所需的 API key |
| `TDAI_GATEWAY_URL` | 否 | 无 | **不会**被 OpenCode 插件配置模块读取；仅 smoke 命令可用它覆盖目标地址 |
| `NO_PROXY` / `no_proxy` | 视本机代理环境而定 | 无 | 当 OpenCode/Bun 进程存在 `HTTP_PROXY`、`HTTPS_PROXY` 或 `ALL_PROXY` 时，建议包含 `127.0.0.1,localhost`，避免本地 Gateway 请求被代理劫持 |

需要特别注意两点：

1. OpenCode 插件本身要求受保护调用必须有 API key。
2. `GET /health` 是 Gateway 上唯一不要求鉴权的检查接口。

如果插件配置里没有 `apiKey`，就会回退到环境变量 `TDAI_GATEWAY_API_KEY`。如果两者都没有，插件会在发出任何受保护请求之前直接失败。

如果你的 shell 或系统环境配置了代理变量，并且 Gateway 使用本机地址 `http://127.0.0.1:8420` 或 `http://localhost:8420`，请在启动 OpenCode 之前设置：

```bash
export NO_PROXY="127.0.0.1,localhost"
export no_proxy="127.0.0.1,localhost"
```

在 Windows PowerShell 中：

```powershell
$env:NO_PROXY = "127.0.0.1,localhost"
$env:no_proxy = "127.0.0.1,localhost"
```

Bun/OpenCode 对代理环境的读取发生在进程启动早期；插件客户端在运行时修改代理变量不能可靠修复这类问题。

## `opencode.json` 配置方式

推荐优先使用环境变量保存密钥，把 `opencode.json` 中的敏感信息降到最低。

### 方式一：npm 安装插件

如果你是通过 npm 包加载插件，可以在 `opencode.json` 里这样配置：

```jsonc
{
  "plugin": [
    [
      "@tencentdb-agent-memory/memory-tencentdb",
      {
        "gatewayUrl": "http://127.0.0.1:8420",
        "timeoutMs": 5000,
        "capture": { "enabled": true },
        "recall": {
          "enabled": true,
          "maxResults": 5,
          "maxTotalChars": 6000
        },
        "tools": { "enabled": true },
        "redaction": { "enabled": true }
      }
    ]
  ]
}
```

说明：

- 这个 npm 包通过 `exports["./server"]` 暴露 OpenCode server entry。
- OpenCode 可以在没有运行 Gateway 的情况下导入 `./server`，但真正的记忆调用仍然要求 `gatewayUrl` 指向一个已经运行的 Gateway。

### 方式二：项目本地 `.opencode/plugins` 路径加载

如果你想在测试项目里按本地目录方式验证插件，不依赖全局 OpenCode 状态，可以使用相对路径：

```jsonc
{
  "plugin": [
    [
      "./.opencode/plugins/memory-tencentdb",
      {
        "gatewayUrl": "http://127.0.0.1:8420"
      }
    ]
  ]
}
```

注意：

- 示例路径必须保持为相对路径。
- 不要在文档或配置样例里写入机器本地绝对路径。
- 不要为了验证本插件去修改全局 OpenCode 配置。
- 本地路径加载方式同样需要 `TDAI_GATEWAY_API_KEY` 或显式 `apiKey` 才能访问受保护 Gateway 路由。

## 配置项说明

以下默认值来自 `src/adapters/opencode/config.ts`，是当前实现的配置真值来源。

| 字段 | 默认值 | 当前行为说明 |
| --- | --- | --- |
| `gatewayUrl` | `http://127.0.0.1:8420` | Gateway 基础地址，会做 URL 规范化 |
| `apiKey` | 无 | 必填；缺失时在任何受保护请求前 fail fast |
| `timeoutMs` | `5000` | Gateway HTTP 客户端默认超时时间 |
| `capture.enabled` | `true` | 打开后，支持的 final assistant-turn event 会触发 `/capture` |
| `recall.enabled` | `true` | 当前仅作为配置字段保留；**不代表**已启用自动 pre-model recall injection |
| `recall.maxResults` | `5` | 当前已进入配置模型，但尚未接入 OpenCode runtime 的工具默认 `limit` |
| `recall.maxTotalChars` | `6000` | 显式 recall/search 工具输出的总字符预算 |
| `tools.enabled` | `true` | 为 `true` 时注册 3 个 OpenCode v1 工具；为 `false` 时不注册工具 |
| `redaction.enabled` | `true` | 当前作为配置字段保留；已交付实现默认总是执行内建脱敏策略 |

### 关于 `timeoutMs`

- 普通 Gateway 调用使用你配置的 `timeoutMs`。
- 启动阶段的 `GET /health` 是非阻塞检查，并且内部会把超时上限限制在 `1000ms`，避免拖慢 OpenCode 启动。

### 关于 `recall.enabled`

虽然这个字段已经进入配置模型，但当前已交付行为仍然是：

- **不承诺**自动 pre-model recall injection。
- 当前最可靠的记忆入口仍然是显式工具：
  - `tdai_memory_recall`
  - `tdai_memory_search`
  - `tdai_conversation_search`

## API key 配置建议

建议按下面优先级使用：

1. **推荐**：在启动 OpenCode 的 shell / process 里设置 `TDAI_GATEWAY_API_KEY`。
2. 本地临时验证：在插件 tuple 里写占位符 `apiKey`，但不要提交真实密钥。

例如，仅用于本地测试的占位写法：

```jsonc
{
  "plugin": [
    [
      "@tencentdb-agent-memory/memory-tencentdb",
      {
        "gatewayUrl": "http://127.0.0.1:8420",
        "apiKey": "replace-with-your-gateway-api-key"
      }
    ]
  ]
}
```

## Gateway 健康检查与运行边界

当前实现的运行边界如下：

- Gateway 必须在插件使用前就已经启动。
- 插件不会管理 Docker 或 Gateway 生命周期。
- 默认 Gateway 地址是 `http://127.0.0.1:8420`。
- `GET /health` 是唯一无需鉴权的请求。
- 健康结果为 `ok` 时，表示 Gateway 可正常提供记忆能力。
- 健康结果为 `degraded` 时，OpenCode 仍应可用，但记忆能力可能会被降级或跳过。
- 当 Gateway 超时、5xx、非 JSON、网络异常等问题发生时，在配置校验通过后，插件应尽量降级而不是让整个对话失败。

示例：

```bash
curl http://127.0.0.1:8420/health
```

## 已实现能力

当前已经交付的 OpenCode 能力包括：

- npm-ready `./server` 导出。
- `dist/opencode/server.js` 与 `dist/opencode/server.d.ts` 构建产物。
- OpenCode 插件配置解析、默认值与 fail-fast 校验。
- Gateway HTTP client：`/health`、`/recall`、`/capture`、`/search/memories`、`/search/conversations`、`/session/end`。
- OpenCode host adapter。
- 三个显式工具：
  - `tdai_memory_recall`
  - `tdai_memory_search`
  - `tdai_conversation_search`
- final turn capture 与 session end flush 生命周期处理。
- CI-safe 默认 smoke 与 strict final-acceptance smoke。

## OpenCode v1 工具范围

OpenCode v1 只暴露以下 3 个用户可见工具：

1. `tdai_memory_recall`
2. `tdai_memory_search`
3. `tdai_conversation_search`

以下工具 **不属于** OpenCode v1：

- admin
- debug
- seed
- delete
- update
- stats
- reset
- 任何数据写入型管理工具

## Recall / Capture / Session End 行为

### Recall

- 当前不承诺自动 pre-model recall injection。
- 显式 recall/search 工具是当前可靠入口。
- `recall.maxResults` 当前已进入配置模型，但还没有接入 OpenCode runtime 的工具默认 `limit` 行为。
- `recall.maxTotalChars` 用于限制显式 recall/search 工具的输出大小。

### Capture

- 在支持的 final assistant-turn event 上，插件会发送一次最小化 `/capture`。
- 默认只发送：
  - user text
  - final assistant text
  - host summary（仅在 oversized messages 已被 host 总结时）

### Session End

- 支持的 session-close/end event 与 `dispose()` 会触发 `/session/end`。
- 对同一个 session key，session end 只会发送一次。
- 如果 session end 失败，会记录脱敏 warning，但不应阻塞 OpenCode 正常退出流程。

### 生命周期 caveat

当前实现对 OpenCode runtime event shape 采取保守策略：

- 已识别的 final-turn / session-close 事件会被处理。
- 不完整或未知 event shape 会被忽略，而不是猜测性 capture。

## 隐私与脱敏默认策略

OpenCode 侧的默认策略是“最小化发送 + 默认脱敏”。

默认包含：

- user text
- final assistant text
- oversized messages 的 host summary

默认排除：

- system prompts
- permission prompts
- shell env
- full tool output
- binary content
- 未经 host summary 的 oversized raw content

默认脱敏覆盖：

- Bearer headers
- `TDAI_GATEWAY_API_KEY`
- 常见 `*_API_KEY`
- `TOKEN`
- `SECRET`
- `PASSWORD`
- `PRIVATE_KEY`
- `ACCESS_TOKEN`
- `REFRESH_TOKEN`

## v1 不支持的内容

以下内容明确不在 OpenCode v1 范围内：

- 短期 context offload / compression
- Docker 管理
- Gateway 安装、启动、停止、重启、监督
- admin / maintenance 工具
- seed / delete / update / debug / stats / reset / mutation 工具
- 在未完成 runtime 验证前承诺自动 recall 注入

## 本地打包与验证流程

建议使用下面这组顺序验证，而不是直接改全局配置：

1. 在 `<repo-root>` 执行构建：

```bash
npm run build
```

2. 检查 dry-run 打包内容：

```bash
npm pack --dry-run
```

确认输出中至少包含：

- `dist/opencode/server.js`
- `dist/opencode/server.d.ts`
- `docs/opencode-memory-plugin.md`

3. 验证 server entry 可导入：

```bash
node --input-type=module -e "await import('./dist/opencode/server.js')"
```

4. 如果要验证本地路径插件加载，在 `<project>` 中准备：

```text
<project>/
  .opencode/
    plugins/
      memory-tencentdb/
```

5. 把打包产物解到 `<project>/.opencode/plugins/memory-tencentdb/`，再用相对路径 tuple 配置加载。

## Smoke 命令

仓库根目录可直接使用这些命令：

```bash
npm run build
npm test
npm pack --dry-run
```

### 默认 smoke

```bash
npm run smoke:opencode-gateway
```

默认行为：

- 先调用 unauthenticated `GET /health`
- 如果 Gateway 不可用，或 `TDAI_GATEWAY_API_KEY` 不存在，则以清晰的 `SKIP` 退出 0
- 不会尝试受保护路由

### strict final-acceptance smoke

```bash
npm run smoke:opencode-gateway -- --final-acceptance
```

如果 npm / shell 对参数转发不稳定，也可以使用：

```bash
TDAI_GATEWAY_SMOKE_MODE=final-acceptance npm run smoke:opencode-gateway
```

严格模式要求：

- Gateway 已运行且健康
- `TDAI_GATEWAY_API_KEY` 已存在
- 真实 loop 成功完成：
  - `/health`
  - `/capture`
  - `/recall` **或** `/search/memories`
  - `/session/end`

说明：

- smoke 支持在 `/recall` 失败或超时时回退到 `/search/memories`。
- smoke 不会启动、停止、配置或监督 Docker / Gateway。
- smoke 输出不能打印原始 `TDAI_GATEWAY_API_KEY`。

## 故障排查

### 1. 插件启动时报 apiKey 缺失

原因：

- 配置里的 `apiKey` 没有设置，且环境变量 `TDAI_GATEWAY_API_KEY` 也不存在。

处理：

- 给启动 OpenCode 的进程设置 `TDAI_GATEWAY_API_KEY`；或
- 仅在本地临时验证时，在 plugin tuple 里写占位 `apiKey`

不要把真实密钥提交到仓库。

### 2. `/health` 正常，但 protected routes 返回 401

原因：

- `GET /health` 天然开放。
- 受保护路由要求 Bearer auth。

处理：

- 确认 Gateway 侧配置了 `TDAI_GATEWAY_API_KEY`
- 确认插件侧 `apiKey` / `TDAI_GATEWAY_API_KEY` 与 Gateway 使用的是同一个值

### 3. OpenCode 启动了，但没有自动记忆注入

原因：

- 这是预期行为。
- 当前版本不承诺 automatic pre-model recall injection。

处理：

- 直接使用：
  - `tdai_memory_recall`
  - `tdai_memory_search`
  - `tdai_conversation_search`

### 4. 用户误以为插件会帮忙启动服务

原因：

- 插件和 Gateway 的职责混淆。

处理：

- 先独立启动 Gateway
- 用 `curl http://127.0.0.1:8420/health` 验证健康
- 再加载 OpenCode 插件

### 5. Gateway 处于 degraded 状态

原因：

- 可能是下游模型、存储或依赖部分失败。

处理：

- OpenCode 应继续可用
- 显式 recall/search 可能部分降级
- 先检查 Gateway 日志和配置，再重试

### 6. 本地 Gateway 请求返回 502 或空 body

原因：

- 启动 OpenCode 的进程继承了 `HTTP_PROXY`、`HTTPS_PROXY` 或 `ALL_PROXY`。
- Bun/OpenCode 可能会把 `127.0.0.1` / `localhost` 的 Gateway 请求也交给代理，导致本机 Gateway 返回看似异常的 `502` 或空响应。

处理：

- 在启动 OpenCode 之前设置 `NO_PROXY` 和 `no_proxy`，并包含 `127.0.0.1,localhost`。
- 设置后重新启动 OpenCode 进程；不要依赖插件运行时修改代理环境。

## 相关文档

- [`docs/opencode-plugin-compatibility.md`](./opencode-plugin-compatibility.md)
- [`docker/standalone/README.md`](../docker/standalone/README.md)
- [`README.md`](../README.md)
