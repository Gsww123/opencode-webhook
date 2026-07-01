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
    get: async () => ({ data: { title: "测试会话", createdAt: "2026-06-30T10:00:00.000Z", updatedAt: "2026-06-30T10:05:30.000Z", model: { id: "gpt-4o", providerID: "openai" } } }),
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
  const mod = await import("../plugin/webhook-notify.js")
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
  const mod = await import("../plugin/webhook-notify.js")
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
  const mod = await import("../plugin/webhook-notify.js")
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
  const mod = await import("../plugin/webhook-notify.js")
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
  const mod = await import("../plugin/webhook-notify.js")
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
    const mod = await import("../plugin/webhook-notify.js")
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
    if (!output.includes("Opencode 任务完成")) throw new Error("任务完成标题不清晰")
    if (!output.includes("项目：test-project")) throw new Error("任务完成正文项目路径应使用 basename")
    if (!output.includes("会话：测试会话")) throw new Error("任务完成正文缺少会话名称")
    if (!output.includes("模型：gpt-4o")) throw new Error("任务完成正文缺少模型信息")
    if (output.includes("状态：")) throw new Error("任务完成正文不应包含冗余状态说明")
    if (output.includes("终端：")) throw new Error("任务完成正文不应显示终端信息")
    if (!output.includes("运行时间：5分30秒")) throw new Error("任务完成正文缺少运行时间")
  })
}

async function testQuestionEvent() {
  const mod = await import("../plugin/webhook-notify.js")
  const plugin = await mod.WatchNotificationPlugin({
    project: { name: "test" },
    client: mockClient,
    $: mockShell(),
    directory: "/tmp/test-project",
    worktree: "/tmp/test-project",
  })
  await plugin.event({
    event: {
      type: "question.asked",
      properties: {
        sessionID: "session-001",
        questions: [{ question: "用哪个框架？", header: "选择框架", options: [{ label: "React", description: "" }, { label: "Vue", description: "" }, { label: "Svelte", description: "" }] }],
      },
    },
  })
}

async function testQuestionCopy() {
  await withConfig({ cmd: "echo \"$TITLE\n$DETAILS\"" }, async () => {
    const mod = await import("../plugin/webhook-notify.js")
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
        type: "question.asked",
        properties: {
          sessionID: "q-session",
          questions: [{ question: "用哪个框架？", header: "选择框架", options: [{ label: "React", description: "" }, { label: "Vue", description: "" }, { label: "Svelte", description: "" }] }],
        },
      },
    })
    const output = $.commands.join("\n")
    if (!output.includes("Opencode 需要你回答问题")) throw new Error("问题通知标题不清晰")
    if (!output.includes("问题：用哪个框架？")) throw new Error("问题通知正文缺少问题内容")
    if (!output.includes("选项：React / Vue / Svelte")) throw new Error("问题通知正文缺少选项信息")
    if (!output.includes("项目：test-project")) throw new Error("问题通知正文缺少项目信息")
    if (!output.includes("会话：测试会话")) throw new Error("问题通知正文应显示会话名称而非 ID")
  })
}

async function testTurnDurationCollect() {
  const mod = await import("../plugin/webhook-notify.js")
  const plugin = await mod.WatchNotificationPlugin({
    project: { name: "test" },
    client: mockClient,
    $: mockShell(),
    directory: "/tmp/test-project",
    worktree: "/tmp/test-project",
  })
  /* 发送 turn.duration 事件 */
  await plugin.event({
    event: { type: "turn.duration", properties: { sessionID: "turn-test", duration: 3000 } },
  })
  await plugin.event({
    event: { type: "turn.duration", properties: { sessionID: "turn-test", duration: 5000 } },
  })
  /* turn.duration 事件不应触发推送，只存内部状态 */
  /* 先验证 idle 不报错 */
  await plugin.event({
    event: { type: "session.idle", properties: { sessionID: "turn-test" } },
  })
}

async function testShowStatsInIdle() {
  await withConfig({ cmd: "echo \"$TITLE\n$DETAILS\"", showStats: true }, async () => {
    const mod = await import("../plugin/webhook-notify.js")
    const $ = mockShell()
    const plugin = await mod.WatchNotificationPlugin({
      project: { name: "test" },
      client: mockClient,
      $,
      directory: "/tmp/test-project",
      worktree: "/tmp/test-project",
    })
    /* 发送两轮耗时事件 */
    await plugin.event({
      event: { type: "turn.duration", properties: { sessionID: "stats-test", duration: 3000 } },
    })
    await plugin.event({
      event: { type: "turn.duration", properties: { sessionID: "stats-test", duration: 5000 } },
    })
    await plugin.event({
      event: { type: "session.idle", properties: { sessionID: "stats-test" } },
    })
    const output = $.commands.join("\n")
    if (!output.includes("轮次统计：共2轮")) throw new Error("showStats 通知应包含轮次统计行")
    if (!output.includes("第1轮：3.0s")) throw new Error("轮次统计应包含第1轮耗时")
    if (!output.includes("第2轮：5.0s")) throw new Error("轮次统计应包含第2轮耗时")
    if (!output.includes("总8.0s")) throw new Error("轮次统计应包含总耗时")
    if (!output.includes("平均4.0s")) throw new Error("轮次统计应包含平均耗时")
    if (!output.includes("最快3.0s")) throw new Error("轮次统计应包含最快耗时")
    if (!output.includes("最慢5.0s")) throw new Error("轮次统计应包含最慢耗时")
  })
}

async function testShowStatsDefaultFalse() {
  await withConfig({ cmd: "echo \"$TITLE\n$DETAILS\"" }, async () => {
    const mod = await import("../plugin/webhook-notify.js")
    const $ = mockShell()
    const plugin = await mod.WatchNotificationPlugin({
      project: { name: "test" },
      client: mockClient,
      $,
      directory: "/tmp/test-project",
      worktree: "/tmp/test-project",
    })
    /* showStats 默认 false，即使有 turn.duration 事件也不应展示 */
    await plugin.event({
      event: { type: "turn.duration", properties: { sessionID: "no-stats", duration: 3000 } },
    })
    await plugin.event({
      event: { type: "session.idle", properties: { sessionID: "no-stats" } },
    })
    const output = $.commands.join("\n")
    if (output.includes("轮次统计")) throw new Error("showStats=false 时不应包含轮次统计")
  })
}

async function testPermissionCopy() {
  await withConfig({ cmd: "echo \"$TITLE\n$DETAILS\"" }, async () => {
    const mod = await import("../plugin/webhook-notify.js")
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
    if (!output.includes("会话：测试会话")) throw new Error("权限申请正文应显示会话名称而非 ID")
  })
}

// ========== 自定义功能测试 ==========

async function testCustomNickname() {
  await withConfig({ cmd: "echo \"$TITLE\n$DETAILS\"", nickname: "主任", emojiPrefix: "🔔", signature: "—— 自动通知" }, async () => {
    const mod = await import("../plugin/webhook-notify.js")
    const $ = mockShell()
    const plugin = await mod.WatchNotificationPlugin({
      project: { name: "test" }, client: mockClient, $,
      directory: "/tmp/test-project", worktree: "/tmp/test-project",
    })
    await plugin.event({ event: { type: "session.idle", properties: { sessionID: "nickname-test" } } })
    const output = $.commands.join("\n")
    if (!output.includes("🔔 主任 Opencode 任务完成")) throw new Error("标题未拼接 nickname/emojiPrefix")
    if (!output.includes("会话：测试会话")) throw new Error("详情中缺少会话名称")
    if (!output.includes("项目：test-project")) throw new Error("详情中项目路径应使用 basename")
    if (!output.includes("—— 自动通知")) throw new Error("详情末尾缺少 signature")
  })
}

async function testIgnoreProjects() {
  await withConfig({ cmd: "echo fired", ignoreProjects: ["test-project"] }, async () => {
    const mod = await import("../plugin/webhook-notify.js")
    const $ = mockShell()
    const plugin = await mod.WatchNotificationPlugin({
      project: { name: "test" }, client: mockClient, $,
      directory: "/tmp/test-project", worktree: "/tmp/test-project",
    })
    await plugin.event({ event: { type: "session.idle", properties: { sessionID: "ignore-test" } } })
    if ($.commands.length > 0) throw new Error("被 ignore 的项目不应触发通知")
  })
}

// ========== JSON 配置文件测试 ==========

async function testGotifyJsonConfig() {
  await withConfig({ gotify: { url: "http://gotify:8080", token: "abc", priority: 8 } }, async () => {
    const mod = await import("../plugin/webhook-notify.js")
    const plugin = await mod.WatchNotificationPlugin({
      project: { name: "test" }, client: mockClient, $: mockShell(),
      directory: "/tmp/test", worktree: "/tmp/test",
    })
    await plugin.event({ event: { type: "session.idle", properties: { sessionID: "g" } } })
  })
}

async function testDesktopJsonConfig() {
  await withConfig({ desktop: true }, async () => {
    const mod = await import("../plugin/webhook-notify.js")
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
    const mod = await import("../plugin/webhook-notify.js")
    const plugin = await mod.WatchNotificationPlugin({
      project: { name: "test" }, client: mockClient, $: mockShell(),
      directory: "/tmp/test", worktree: "/tmp/test",
    })
    await plugin.event({ event: { type: "session.idle", properties: { sessionID: "w" } } })
  })
}

async function testCmdJsonConfig() {
  await withConfig({ cmd: "echo test" }, async () => {
    const mod = await import("../plugin/webhook-notify.js")
    const plugin = await mod.WatchNotificationPlugin({
      project: { name: "test" }, client: mockClient, $: mockShell(),
      directory: "/tmp/test", worktree: "/tmp/test",
    })
    await plugin.event({ event: { type: "session.idle", properties: { sessionID: "c" } } })
  })
}

async function testMultiChannelJsonConfig() {
  await withConfig({ gotify: { url: "http://g:8080", token: "t" }, desktop: true }, async () => {
    const mod = await import("../plugin/webhook-notify.js")
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
  await runTest("question 事件", testQuestionEvent)
  await runTest("任务完成文案", testTaskCompleteCopy)
  await runTest("权限申请文案", testPermissionCopy)
  await runTest("问题通知文案", testQuestionCopy)
  await runTest("自定义称呼/表情/签名", testCustomNickname)
  await runTest("项目忽略名单", testIgnoreProjects)
  await runTest("turn.duration 收集", testTurnDurationCollect)
  await runTest("showStats 展示轮次统计", testShowStatsInIdle)
  await runTest("showStats 默认不展示", testShowStatsDefaultFalse)
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
