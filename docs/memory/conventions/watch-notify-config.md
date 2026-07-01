# watch-notify 配置说明

> 最后更新: 2026-07-01

## 配置文件

`watch-notify.json`，支持 5 种推送渠道。每个渠道是 JSON 的顶级字段，**填了就启用，不填就不用**。

配置文件查找顺序（优先级从高到低）：
1. 当前工作目录 `watch-notify.json`
2. `~/.config/opencode/watch-notify.json`
3. 默认行为（写日志到 `/tmp/opencode-notify.log`）

## 渠道说明

| 渠道 | 启用条件 | 关键字段 |
|------|---------|---------|
| `desktop` | 填 `true` | 仅 true/false |
| `gotify` | `url`+`token` 非空 | url, token, priority |
| `webhook` | `url` 非空 | url, method, headers, timeout |
| `smtp` | `host`+`user`+`pass`+`to` 非空 | host, port, user, pass, from, to |
| `cmd` | `cmd` 非空 | cmd, cmdTimeout |

## 自定义功能字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `nickname` | string | `""` | 自定义称呼，拼接到通知标题 |
| `emojiPrefix` | string | `""` | 表情前缀，拼接到通知标题最前面 |
| `signature` | string | `""` | 签名，追加到通知详情底部 |
| `ignoreProjects` | string[] | `[]` | 项目忽略名单 |
| `showStats` | boolean | `false` | 是否在任务完成通知中展示每轮对话耗时统计 |

## 当前启用的渠道

目前只启用了 `desktop`，其他渠道留空模板可随时填入启用。