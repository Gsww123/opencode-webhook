/**
 * 开发测试脚本 — 模拟 opencode 环境测试自包含插件
 *
 * 用法:
 *   node test/test.js
 *   WATCH_NOTIFY_DEV=true node test/test.js  # 启用开发日志
 */

import { writeFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"

// ========== Mock Bun Shell API ($) ==========
function mockShell() {
  const commands = []
  return new Proxy(() => {}, {
    apply(target, thisArg, args) {
      let cmd = ""
      const templateParts = args[0]?.raw ? args[0] : [String(args[0] ?? "")]
      for (let i = 0; i < templateParts.length; i++) {
        cmd += templateParts[i]
        if (i < args.length - 1) {
          const value = args[i + 1]
          cmd += Array.isArray(value) ? value.join(" ") : String(value)
        }
      }
      commands.push(cmd)
      console.log(`  [Shell] ${cmd}`)
      return createPromise()
    },
    get(target, prop) {
      if (prop === "commands") return commands
      if (prop === "timeout") return () => createPromise()
      if (prop === "quiet") return () => createPromise()
      return target[prop]
    },
  })
}

function createPromise() {
  let timer = null
  const p = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ stdout: "", stderr: "", exitCode: 0 }), 10)
  })
  p.timeout = () => { clearTimeout(timer); return createPromise() }
  p.quiet = () => p
  return p
}

// ========== 模拟 opencode client ==========
const mockClient = {
  app: {
    log: async ({ body }) => {
      console.log(`  [插件日志] level=${body.level} message=${body.message}`)
      if (body.extra) console.log(`             extra=${JSON.stringify(body.extra)}`)
    },
  },
  session: {
    get: async () => ({ data: { title: "测试会话", createdAt: "2026-06-30T10:00:00.000Z", updatedAt: "2026-06-30T10:05:30.000Z" } }),
  },
}

// ========== JSON 配置文件辅助 ==========
const CONFIG_PATH = join(process.cwd(), "watch-notify.json")

async function withConfig(data, fn) {
  writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), "utf-8")
  try { return await fn() } finally { try { unlinkSync(CONFIG_PATH) } catch {} }
}

// ========== 测试运行器 ==========
let passed = 0
let failed = 0

async function runTest(name, fn) {
  process.stdout.write(`\n  ▶ ${name} ... `)
  try {
    await fn()
    console.log("✓ 通过")
    passed++
  } catch (err) {
    console.log(`✗ 失败: ${err.message}`)
    failed++
  }
}

// ========== 测试用例 ==========

async function testPluginInit() {
  const mod = await import("../plugin/watch-notify.js")
  const plugin = await mod.WatchNotificationPlugin({
    project: { name: "test" },
    client: mockClient,
    $: mockShell(),
    directory: "/tmp/test-project",
    worktree: "/tmp/test-project",
  })
  if (typeof plugin.event !== "function") {
    throw new Error("插件未返回 event 方法")
  }
}

async function testPermissionEvent() {
  const mod = await import("../plugin/watch-notify.js")
  const plugin = await mod.WatchNotificationPlugin({
    project: { name: "test" },
    client: mockClient,
    $: mockShell(),
    directory: "/tmp/test-project",
    worktree: "/tmp/test-project",
  })
  await plugin.event({
    event: {
      type: "permission.asked",
      properties: { id: "perm-001", sessionID: "session-001", permission: "command", pattern: "rm -rf" },
    },
  })
}

async function testIdleEvent() {
  const mod = await import("../plugin/watch-notify.js")
  const plugin = await mod.WatchNotificationPlugin({
    project: { name: "test" },
    client: mockClient,
    $: mockShell(),
    directory: "/tmp/test-project",
    worktree: "/tmp/test-project",
  })
  await plugin.event({
    event: { type: "session.idle", properties: { sessionID: "session-001" } },
  })
}

async function testDedup() {
  const mod = await import("../plugin/watch-notify.js")
  const plugin = await mod.WatchNotificationPlugin({
    project: { name: "test" },
    client: mockClient,
    $: mockShell(),
    directory: "/tmp/test-project",
    worktree: "/tmp/test-project",
  })
  await plugin.event({ event: { type: "session.idle", properties: { sessionID: "dedup-test" } } })
  const before = Date.now()
  await plugin.event({ event: { type: "session.idle", properties: { sessionID: "dedup-test" } } })
  const elapsed = Date.now() - before
  if (elapsed > 100) {
    throw new Error(`去重可能失效: 第二次调用耗时 ${elapsed}ms（预期 < 100ms）`)
  }
}

async function testPermissionDedup() {
  const mod = await import("../plugin/watch-notify.js")
  const plugin = await mod.WatchNotificationPlugin({
    project: { name: "test" },
    client: mockClient,
    $: mockShell(),
    directory: "/tmp/test-project",
    worktree: "/tmp/test-project",
  })
  await plugin.event({
    event: { type: "permission.asked", properties: { id: "dedup-perm", sessionID: "s1", permission: "test" } },
  })
  const before = Date.now()
  await plugin.event({
    event: { type: "permission.asked", properties: { id: "dedup-perm", sessionID: "s1", permission: "test" } },
  })
  const elapsed = Date.now() - before
  if (elapsed > 100) {
    throw new Error(`权限去重可能失效: 耗时 ${elapsed}ms`)
  }
}

async function testTaskCompleteCopy() {
  await withConfig({ cmd: "echo \"$TITLE\n$DETAILS\"" }, async () => {
    const mod = await import("../plugin/watch-notify.js")
    const $ = mockShell()
    const plugin = await mod.WatchNotificationPlugin({
      project: { name: "test" },
      client: mockClient,
      $,
      directory: "/tmp/test-project",
      worktree: "/tmp/test-project",
    })
    await plugin.event({
      event: { type: "session.idle", properties: { sessionID: "copy-task" } },
    })
    const output = $.commands.join("\n")
  if (!output.includes("Opencode 任务完成：测试会话")) throw new Error("任务完成标题不清晰")
  if (!output.includes("状态：任务已完成，可以查看结果")) throw new Error("任务完成正文缺少状态说明")
  if (output.includes("会话：")) throw new Error("任务完成正文不应显示会话信息")
  if (output.includes("终端：")) throw new Error("任务完成正文不应显示终端信息")
  if (!output.includes("运行时间：5分30秒")) throw new Error("任务完成正文缺少运行时间")
  })
}

async function testPermissionCopy() {
  await withConfig({ cmd: "echo \"$TITLE\n$DETAILS\"" }, async () => {
    const mod = await import("../plugin/watch-notify.js")
    const $ = mockShell()
    const plugin = await mod.WatchNotificationPlugin({
      project: { name: "test" },
      client: mockClient,
      $,
      directory: "/tmp/test-project",
      worktree: "/tmp/test-project",
    })
    await plugin.event({
      event: {
        type: "permission.asked",
        properties: { id: "copy-perm", sessionID: "copy-session", permission: "command.execute", pattern: "git push origin main" },
      },
    })
    const output = $.commands.join("\n")
    if (!output.includes("Opencode 需要你批准操作")) throw new Error("权限申请标题不清晰")
    if (!output.includes("权限：command.execute")) throw new Error("权限申请正文缺少权限类型")
    if (!output.includes("操作：git push origin main")) throw new Error("权限申请正文缺少操作说明")
    if (!output.includes("会话：copy-session")) throw new Error("权限申请正文缺少会话信息")
  })
}

// ========== JSON 配置文件测试 ==========

async function testGotifyJsonConfig() {
  await withConfig({ gotify: { url: "http://gotify:8080", token: "abc", priority: 8 } }, async () => {
    const mod = await import("../plugin/watch-notify.js")
    const plugin = await mod.WatchNotificationPlugin({
      project: { name: "test" }, client: mockClient, $: mockShell(),
      directory: "/tmp/test", worktree: "/tmp/test",
    })
    await plugin.event({ event: { type: "session.idle", properties: { sessionID: "g" } } })
  })
}

async function testDesktopJsonConfig() {
  await withConfig({ desktop: true }, async () => {
    const mod = await import("../plugin/watch-notify.js")
    const $ = mockShell()
    const plugin = await mod.WatchNotificationPlugin({
      project: { name: "test" }, client: mockClient, $,
      directory: "/tmp/test", worktree: "/tmp/test",
    })
    await plugin.event({ event: { type: "session.idle", properties: { sessionID: "d" } } })
    const output = $.commands.join("\n")
    if (output.includes("Opencode: Opencode 任务完成")) throw new Error("桌面通知标题不应重复来源名称")
  })
}

async function testWebhookJsonConfig() {
  await withConfig({ webhook: { url: "https://hook.example.com/n" } }, async () => {
    const mod = await import("../plugin/watch-notify.js")
    const plugin = await mod.WatchNotificationPlugin({
      project: { name: "test" }, client: mockClient, $: mockShell(),
      directory: "/tmp/test", worktree: "/tmp/test",
    })
    await plugin.event({ event: { type: "session.idle", properties: { sessionID: "w" } } })
  })
}

async function testCmdJsonConfig() {
  await withConfig({ cmd: "echo test" }, async () => {
    const mod = await import("../plugin/watch-notify.js")
    const plugin = await mod.WatchNotificationPlugin({
      project: { name: "test" }, client: mockClient, $: mockShell(),
      directory: "/tmp/test", worktree: "/tmp/test",
    })
    await plugin.event({ event: { type: "session.idle", properties: { sessionID: "c" } } })
  })
}

async function testMultiChannelJsonConfig() {
  await withConfig({ gotify: { url: "http://g:8080", token: "t" }, desktop: true }, async () => {
    const mod = await import("../plugin/watch-notify.js")
    const plugin = await mod.WatchNotificationPlugin({
      project: { name: "test" }, client: mockClient, $: mockShell(),
      directory: "/tmp/test", worktree: "/tmp/test",
    })
    await plugin.event({ event: { type: "session.idle", properties: { sessionID: "multi" } } })
  })
}

// ========== 主入口 ==========
async function main() {
  console.log("")
  console.log("╔══════════════════════════════════════════╗")
  console.log("║   Opencode Watch Notify — 开发测试套件   ║")
  console.log("╚══════════════════════════════════════════╝")
  console.log("")

  await runTest("插件初始化", testPluginInit)
  await runTest("permission 事件", testPermissionEvent)
  await runTest("idle 事件", testIdleEvent)
  await runTest("会话去重", testDedup)
  await runTest("权限去重", testPermissionDedup)
  await runTest("任务完成文案", testTaskCompleteCopy)
  await runTest("权限申请文案", testPermissionCopy)
  await runTest("Gotify JSON 配置", testGotifyJsonConfig)
  await runTest("桌面通知 JSON 配置", testDesktopJsonConfig)
  await runTest("Webhook JSON 配置", testWebhookJsonConfig)
  await runTest("自定义命令 JSON 配置", testCmdJsonConfig)
  await runTest("多渠道 JSON 配置", testMultiChannelJsonConfig)

  console.log("")
  console.log(`╔══ 结果: 通过=${passed} 失败=${failed} ══╗`)
  if (process.env.WATCH_NOTIFY_DEV === "true") {
    console.log("  开发日志: /tmp/watch-notify-dev.log")
  }
  console.log("")
}

main().catch((err) => {
  console.error("测试异常:", err)
  process.exit(1)
})
