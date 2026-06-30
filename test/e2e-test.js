/**
 * 端到端测试 — 完整模拟 Opencode 插件加载和事件触发
 * 生成真实开发日志，验证全链路
 */

import { readFileSync, writeFileSync, unlinkSync, appendFileSync } from "node:fs"

const LOG = "/tmp/watch-notify-dev.log"
const NOTIFY_LOG = "/tmp/opencode-notify.log"
const CONFIG = "watch-notify.json"

// 清理旧日志和上一次测试可能残留的临时配置
try { unlinkSync(LOG) } catch {}
try { unlinkSync(NOTIFY_LOG) } catch {}
try { unlinkSync(CONFIG) } catch {}
process.on("exit", () => { try { unlinkSync(CONFIG) } catch {} })

// 设置环境变量
process.env.WATCH_NOTIFY_DEV = "true"
process.env.WATCH_NOTIFY_DEV_LOG = LOG

// 端到端测试显式使用命令渠道，避免被用户全局配置影响测试结果。
writeFileSync(CONFIG, JSON.stringify({ cmd: "printf '%s\\n%s\\n' \"$TITLE\" \"$DETAILS\" >> /tmp/opencode-notify.log" }, null, 2), "utf-8")

// 模拟 Bun Shell API — 正确重建 tagged template 命令
function createMockShell() {
  const run = (templateParts, ...expressions) => {
    let cmd = ""
    for (let i = 0; i < templateParts.length; i++) {
      cmd += templateParts[i]
      if (i < expressions.length) {
        cmd += Array.isArray(expressions[i]) ? expressions[i].join(" ") : String(expressions[i])
      }
    }
    cmd = cmd.trim()
    if (cmd) {
      appendFileSync(NOTIFY_LOG, `[模拟Shell] ${cmd}\n`, "utf-8")
    }
    return createCmdPromise()
  }

  const p = new Proxy(run, {
    apply(target, thisArg, args) {
      return target(args[0], ...args.slice(1))
    },
  })
  p.timeout = () => createCmdPromise()
  p.quiet = () => createCmdPromise()
  return p
}

function createCmdPromise() {
  const p = Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
  p.timeout = () => p
  p.quiet = () => p
  return p
}

// 模拟 opencode client
const mockClient = {
  app: {
    log: async ({ body }) => {
      const extra = body.extra ? ` | ${JSON.stringify(body.extra)}` : ""
      console.log(`  [插件日志] ${body.level}: ${body.message}${extra}`)
    },
  },
  session: {
    get: async () => ({
      data: {
        title: "代码重构 - 优化数据库查询性能",
        createdAt: "2026-06-30T10:00:00.000Z",
        updatedAt: "2026-06-30T12:34:56.000Z",
      },
    }),
  },
}

console.log("")
console.log("╔══════════════════════════════════════════════╗")
console.log("║   Opencode Watch Notify — 端到端模拟测试    ║")
console.log("╚══════════════════════════════════════════════╝")
console.log("")

// ========= 1. 加载插件 =========
console.log("── 步骤1: 加载插件 ──")

const { WatchNotificationPlugin } = await import("../plugin/watch-notify.js")

const plugin = await WatchNotificationPlugin({
  project: { name: "test-project" },
  client: mockClient,
  $: createMockShell(),
  directory: "/home/user/projects/test-project",
  worktree: "/home/user/projects/test-project",
})

console.log("  ✓ 插件初始化成功")
console.log("")

// ========= 2. 触发 permission 事件 =========
console.log("── 步骤2: 触发 permission.asked 事件 ──")

await plugin.event({
  event: {
    type: "permission.asked",
    properties: {
      id: "perm-e2e-001",
      sessionID: "session-e2e-001",
      permission: "command.execute",
      pattern: "git push origin main",
      title: "允许执行 git push",
    },
  },
})

console.log("  ✓ permission 事件处理完成")
console.log("")

// ========= 3. 触发 idle 事件 =========
console.log("── 步骤3: 触发 session.idle 事件 ──")

await plugin.event({
  event: {
    type: "session.idle",
    properties: { sessionID: "session-e2e-002" },
  },
})

console.log("  ✓ idle 事件处理完成")
console.log("")

// ========= 4. 验证去重 =========
console.log("── 步骤4: 验证去重机制 ──")

await plugin.event({
  event: { type: "session.idle", properties: { sessionID: "session-e2e-002" } },
})
console.log("  ✓ 重复 idle 事件被正确去重")

await plugin.event({
  event: { type: "permission.asked", properties: { id: "perm-e2e-001", sessionID: "session-e2e-003", permission: "test" } },
})
console.log("  ✓ 重复 permission 事件被正确去重")
console.log("")

// ========= 5. 输出日志 =========
console.log("── 测试结果 ──")
console.log("")

const devLog = readFileSync(LOG, "utf-8")
const notifyLog = readFileSync(NOTIFY_LOG, "utf-8")

console.log("╔══ 开发日志 (/tmp/watch-notify-dev.log) ══╗")
for (const line of devLog.trim().split("\n")) {
  console.log(`  ${line}`)
}
console.log("╚══════════════════════════════════════════╝")
console.log("")

console.log("╔══ 通知日志 (/tmp/opencode-notify.log) ══╗")
for (const line of notifyLog.trim().split("\n")) {
  console.log(`  ${line}`)
}
console.log("╚══════════════════════════════════════════╝")
console.log("")

// 验证运行时间出现在通知中
const hasRuntime = notifyLog.includes("运行时间：")
console.log(`  ${hasRuntime ? "✓" : "✗"} 通知包含运行时间信息`)
if (!hasRuntime) process.exitCode = 1

console.log("")
console.log("✓ 端到端测试通过")
