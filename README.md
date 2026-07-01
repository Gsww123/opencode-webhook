# Opencode Watch Notify

> **Opencode 插件：当 AI 任务完成或需要权限批准时，自动通过 Gotify / 桌面通知 / Webhook / 邮件 / 自定义命令 推送消息。**

---

## 目录

- [快速开始](#快速开始)
- [安装](#安装)
- [配置文件](#配置文件)
  - [配置查找顺序](#配置查找顺序)
  - [Gotify 推送](#gotify-推送)
  - [桌面通知](#桌面通知)
  - [Webhook 推送](#webhook-推送)
  - [SMTP 邮件推送](#smtp-邮件推送)
  - [自定义命令](#自定义命令)
  - [同时使用多个渠道](#同时使用多个渠道)
- [变量占位符](#变量占位符)
- [事件说明](#事件说明)
- [开发日志](#开发日志)
- [项目结构](#项目结构)
- [开发测试](#开发测试)
- [技术要点](#技术要点)

---

## 快速开始

### 1. 安装插件

```bash
# 复制插件到 Opencode 的全局插件目录
cp plugin/watch-notify.js ~/.config/opencode/plugins/

# 重启 Opencode 即可自动加载（无需修改任何配置文件）
```

### 2. 写配置文件

在当前目录或 `~/.config/opencode/` 下创建 `watch-notify.json`：

```json
{
  "gotify": {
    "url": "http://你的服务器:8080",
    "token": "你的应用Token"
  }
}
```

### 3. 完成

重启 Opencode，执行任务。任务结束后 Gotify 自动收到通知。

---

## 安装

```bash
# 复制插件到 Opencode 插件目录
cp plugin/watch-notify.js ~/.config/opencode/plugins/
```

插件会自动加载，**无需在 `opencode.json` 中声明**。

---

## 配置文件

配置文件是 `watch-notify.json`，支持 5 种推送渠道。**每个渠道是 JSON 的顶级字段，填了就启用，不填就不用。**

### 配置查找顺序

1. **当前工作目录** `watch-notify.json` — 项目级配置，优先级最高
2. **全局目录** `~/.config/opencode/watch-notify.json` — 用户级配置
3. **都不存在** — 使用默认行为（写日志到 `/tmp/opencode-notify.log`）

---

### Gotify 推送

> [Gotify](https://gotify.net/) 是一个自托管的消息推送服务，支持 Android、Web 等客户端。**最推荐的方式，配置最简单。**

```json
{
  "gotify": {
    "url": "http://192.168.1.100:8080",
    "token": "Axxxxxxxxxxxxxx",
    "priority": 5
  }
}
```

| 字段 | 必填 | 说明 | 默认值 |
|------|------|------|--------|
| `url` | ✅ | Gotify 服务器地址 | — |
| `token` | ✅ | 应用 Token（在 Gotify Web 界面创建应用获取） | — |
| `priority` | ❌ | 消息优先级 1-10 | `5` |

---

### 桌面通知

```json
{
  "desktop": true
}
```

- **Linux**：使用 `notify-send`（一般桌面环境已自带）
- **macOS**：使用 `osascript` 原生通知
- **Windows**：暂不支持

---

### Webhook 推送

```json
{
  "webhook": {
    "url": "https://hooks.example.com/notify",
    "method": "POST",
    "headers": {
      "Authorization": "Bearer xxxxx"
    }
  }
}
```

| 字段 | 必填 | 说明 | 默认值 |
|------|------|------|--------|
| `url` | ✅ | Webhook 地址 | — |
| `method` | ❌ | HTTP 方法 | `POST` |
| `headers` | ❌ | 自定义请求头 | `{}` |
| `template` | ❌ | 请求体模板（JSON 对象，支持变量占位符） | 空 |
| `timeout` | ❌ | 超时时间（毫秒） | `10000` |

---

### SMTP 邮件推送

```json
{
  "smtp": {
    "host": "smtp.gmail.com",
    "port": 587,
    "secure": false,
    "user": "your@gmail.com",
    "pass": "你的应用专用密码",
    "from": "your@gmail.com",
    "to": ["admin@example.com"],
    "subject": "$TITLE"
  }
}
```

| 字段 | 必填 | 说明 | 默认值 |
|------|------|------|--------|
| `host` | ✅ | SMTP 服务器地址 | — |
| `port` | ❌ | 端口 | `587` |
| `secure` | ❌ | true=直接 SSL，false=STARTTLS | `false` |
| `user` | ✅ | 登录用户名 | — |
| `pass` | ✅ | 登录密码或应用专用密码 | — |
| `from` | ❌ | 发件人地址 | 同 `user` |
| `to` | ✅ | 收件人（字符串或字符串数组） | — |
| `subject` | ❌ | 邮件主题 | `$TITLE` |

> **Gmail 用户请注意**：密码需要使用"应用专用密码"，而不是 Gmail 登录密码。[如何生成应用专用密码](https://support.google.com/accounts/answer/185833)

---

### 自定义命令

```json
{
  "cmd": "curl -d '通知: $TITLE' http://my-bot/api"
}
```

通过 `/bin/sh -c` 执行任意命令，支持所有变量占位符。

| 字段 | 必填 | 说明 | 默认值 |
|------|------|------|--------|
| `cmd` | ✅ | Shell 命令 | — |
| `cmdTimeout` | ❌ | 超时（毫秒） | `30000` |

---

### 同时使用多个渠道

多个渠道可以同时启用，全部生效：

```json
{
  "gotify": {
    "url": "http://192.168.1.100:8080",
    "token": "Axxxxxxxxxxxxxx",
    "priority": 8
  },
  "desktop": true,
  "webhook": {
    "url": "https://hooks.example.com/notify"
  },
  "smtp": {
    "host": "smtp.gmail.com",
    "port": 587,
    "user": "your@gmail.com",
    "pass": "your-app-password",
    "to": "admin@example.com"
  },
  "cmd": "echo 任务完成: $TITLE >> /tmp/my-log.txt"
}
```

---

## 变量占位符

在 `cmd` 命令中可以使用以下占位符，插件会自动替换为实际值：

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `$SOURCE` | 来源名称 | `opencode` |
| `$SOURCE_LABEL` | 来源显示名 | `Opencode` |
| `$TITLE` | 通知标题 | `Opencode 任务完成：代码重构` |
| `$DETAILS` | 通知详情 | `项目：my-project\n运行时间：5分30秒` |
| `$RUNTIME` | 运行时间 | `5分30秒` |
| `$SESSION_ID` | 会话 ID | `cm-xxxxx` |
| `$TTY` | 调用者终端号 | `/dev/pts/0` |
| `$NICKNAME` | 自定义称呼（见下文） | `主任` |
| `$EMOJI_PREFIX` | 自定义表情前缀（见下文） | `🔔` |
| `$SIGNATURE` | 自定义签名字（见下文） | `—— 自动通知` |
| `$DIRECTORY` | 项目完整路径 | `/home/user/projects/my-project` |
| `$PROJECT` | 项目名（路径最后一级） | `my-project` |

---

## 自定义功能

在 `watch-notify.json` 顶层添加以下字段，即可定制通知内容：

### 称呼 / 表情 / 签名

```json
{
  "nickname": "主任",
  "emojiPrefix": "🔔",
  "signature": "—— 来自 Opencode 机器人"
}
```

| 字段 | 效果 | 模板变量 |
|------|------|---------|
| `nickname` | 自动拼接到标题：`🔔 主任 Opencode 任务完成：xxx` | `$NICKNAME` |
| `emojiPrefix` | 自动拼接到标题最前面 | `$EMOJI_PREFIX` |
| `signature` | 自动追加到通知详情底部 | `$SIGNATURE` |

**标题拼接规则**：
```
${emojiPrefix} ${nickname} ${label} 任务完成：${title}

示例:
🔔 主任 Opencode 任务完成：重构登录模块
（没配 emoji）主任 Opencode 任务完成：重构登录模块
（都没配）Opencode 任务完成：重构登录模块
```

### 项目忽略名单

配置后，匹配的项目不会触发任何通知：

```json
{
  "ignoreProjects": ["temp-test", "/mnt/e/temp"]
}
```

匹配规则：同时支持**完整路径**和**项目名（basename）**匹配。

### 轮次统计

开启后，任务完成通知中会附带每轮对话的耗时统计：

```json
{
  "showStats": true
}
```

默认为 `false`。开启后通知示例：

```text
项目：my-project
会话：代码重构
运行时间：5分30秒
轮次统计：共2轮
第1轮：3.0s | 第2轮：5.0s
总8.0s | 平均4.0s | 最快3.0s | 最慢5.0s
```

---

## 事件说明

插件监听 Opencode 的以下事件：

| 事件 | 触发时机 |
|------|----------|
| 任务完成 | AI 执行完任务进入 idle 状态 |
| 权限申请 | AI 需要用户批准执行命令或访问文件 |
| 用户提问 | AI 需要用户回答问题或做出选择 |

默认通知文案会区分三种状态：

- 任务完成：标题以“Opencode 任务完成”开头，正文包含项目、状态和运行时间。
- 权限申请：标题为“Opencode 需要你批准操作”，正文包含项目、权限、操作和会话。
- 用户提问：标题为“Opencode 需要你回答问题”，正文包含项目、问题、选项和会话。

**去重机制**：
- 同一会话 5 秒内重复的 idle 事件只推送一次
- 同一 permission ID 只会推送一次（避免重复弹窗）

---

## 开发日志

排查问题时可以开启开发日志：

```bash
export WATCH_NOTIFY_DEV=true

# 启动 Opencode 后，在另一个终端查看实时日志
tail -f /tmp/watch-notify-dev.log
```

---

## 项目结构

```
opencode-watch-notify/
├── AGENT.md                  # 项目说明（AI 阅读用）
├── README.md                 # 使用文档
├── plugin/
│   └── watch-notify.js       # 核心插件（单文件自包含，零外部依赖）
└── test/
    ├── test.js               # 单元测试（12 个用例）
    └── e2e-test.js           # 端到端模拟测试
```

---

## 开发测试

```bash
# 运行全部单元测试
node test/test.js

# 启用开发日志运行测试
WATCH_NOTIFY_DEV=true node test/test.js

# 端到端模拟测试（模拟完整事件流）
node test/e2e-test.js
```

测试内容：
1. 插件初始化 — 验证能正常加载
2. permission 事件 — 权限申请触发通知
3. idle 事件 — 任务完成触发通知
4. 会话去重 — 5 秒内重复事件被过滤
5. 权限去重 — 同一权限 ID 只发一次
6. Gotify JSON 配置 — 从 JSON 文件读取 Gotify 配置
7. 桌面通知 JSON 配置 — 从 JSON 文件读取桌面通知配置
8. Webhook JSON 配置 — 从 JSON 文件读取 Webhook 配置
9. 自定义命令 JSON 配置 — 从 JSON 文件读取命令配置
10. 多渠道 JSON 配置 — 多个渠道同时生效

---

## 技术要点

- **单文件自包含**：所有逻辑在 `watch-notify.js` 中，零外部依赖
- **原生 SMTP**：手写 SMTP 协议实现邮件发送，不依赖 `nodemailer` 等第三方库
- **Opencode 标准 API**：使用 `$` Bun Shell API、`client.app.log`、`client.session.get`
- **事件驱动**：监听 `permission.asked`、`permission.updated`、`session.idle`、`session.status`
- **iOS 过滤**：通过 `MIMOCODE_IOS_SESSION_TITLE` / `OPENCODE_IOS_SESSION_TITLE` 环境变量过滤 iOS Chat 会话
- **优雅降级**：单个推送渠道失败不影响其他渠道，失败信息记录到开发日志

---

## 许可证

MIT
