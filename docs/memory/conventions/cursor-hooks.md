# Cursor Hooks 配置

> 最后更新: 2026-06-30

## 用途

Cursor agent 事件发生时通过 Gotify 推送通知到手机。

## 触发事件

| 事件 | 触发条件 | 推送内容 |
|------|---------|---------|
| `sessionStart` | Agent 会话开始 | 会话名称+ID、模型 |
| `sessionEnd` | Agent 会话结束 | 会话名称+ID、模型、状态（中文） |
| `beforeShellExecution` | 执行重要命令（匹配 install/build/deploy/push/docker/kubectl/npm/npx/pnpm/bun） | 命令内容、工作目录 |
| `stop` | Agent 停止（限制循环 3 次） | 状态（中文）、会话名称+ID |

## 推送脚本改进

2026-06-30:
- 模型：若 hook 事件未携带 `model` 字段，自动回退 `model_name`/`model_id`；原始标识符（如 `claude-sonnet-4-20250514`）自动美化为可读名称（如 `Claude Sonnet 4`）
- 会话：优先取 `conversation_title`/`title` 作为会话名称展示，ID 缩短为后缀形式 `名称（ID前8位）`
- 状态：英文状态自动映射为中文（completed→已完成, aborted→已中止, failed→失败, error→出错）

## 配置位置

项目级配置，仅对当前仓库生效：
- `.cursor/hooks.json` — 事件绑定配置
- `.cursor/hooks/notify-gotify.js` — 推送脚本

## 推送目标

- Gotify 服务器：`http://n1.030805.xyz:8385`
- 优先级：5
- 脚本用 `fetch` 直连 Gotify API，无需外部依赖

## 添加新 Hook

在 `.cursor/hooks.json` 对应事件数组中加条目即可，脚本可复用 `notify-gotify.js`。