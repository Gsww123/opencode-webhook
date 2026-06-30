# Opencode Watch Notify — 插件说明

## 功能
Opencode 任务完成或需要权限批准时，通过多种渠道推送通知。

## 配置方式
在当前目录或 `~/.config/opencode/` 下放 `watch-notify.json`。
顶级字段：`gotify` / `desktop` / `webhook` / `smtp` / `cmd`，填了就启用，不填就不用。

## 配置优先级
当前目录 `watch-notify.json` > `~/.config/opencode/watch-notify.json` > 默认（写日志）

## 推送类型
- `gotify` — Gotify 自托管推送（最推荐）
- `command` — Shell 命令
- `webhook` — HTTP POST
- `desktop` — 桌面通知
- `smtp` — 邮件（零依赖手写 SMTP 协议）

## 技术要点
- 单文件自包含，零外部依赖
- 使用 Opencode 插件标准 API
- 去重：同会话 5s 内只发一次，同权限 ID 只发一次
- iOS Chat 会话自动过滤
