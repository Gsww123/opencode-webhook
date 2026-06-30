/**
 * Opencode Watch Notify — 自包含插件
 *
 * 监听 idle 和 permission 事件，通过可配置的 hook 链发送通知。
 * 完全符合 Opencode 插件规范，单文件自包含，零外部依赖。
 */

import { readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { createConnection } from "node:net"
import { connect as tlsConnect } from "node:tls"

// ============================================================
// 默认配置
// ============================================================

const DEFAULT_CONFIG = {
  notifySource: "opencode",
  hooks: {
    onTaskComplete: [
      {
        type: "command",
        enabled: true,
        cmd: "/bin/sh",
        args: ["-c", "printf '[%s] %s\\n%s\\n' \"$SOURCE\" \"$TITLE\" \"$DETAILS\" >> /tmp/opencode-notify.log"],
      },
      { type: "webhook", enabled: false, url: "", method: "POST", headers: {}, template: null, timeout: 10000 },
      { type: "desktop", enabled: false, title: "$SOURCE_LABEL: 任务已完成" },
      { type: "smtp",   enabled: false, host: "", port: 587, secure: false, auth: {}, from: "", to: [], subject: "$TITLE" },
    ],
    onPermissionRequest: [
      {
        type: "command",
        enabled: true,
        cmd: "/bin/sh",
        args: ["-c", "printf '[%s] %s\\n%s\\n' \"$SOURCE\" \"$TITLE\" \"$DETAILS\" >> /tmp/opencode-notify.log"],
      },
    ],
  },
}

// ============================================================
// 开发日志
// ============================================================

const DEV_MODE = process.env.WATCH_NOTIFY_DEV === "true"
const DEV_LOG_PATH = process.env.WATCH_NOTIFY_DEV_LOG || "/tmp/watch-notify-dev.log"

function devLog(...args) {
  if (!DEV_MODE) return
  try {
    const ts = new Date().toISOString()
    const line = `[${ts}] ${args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")}\n`
    mkdirSync(dirname(DEV_LOG_PATH), { recursive: true })
    appendFileSync(DEV_LOG_PATH, line, "utf-8")
  } catch { /* 开发日志写入失败不影响主流程 */ }
}

// ============================================================
// 配置加载
// ============================================================

/* 配置加载优先级：当前目录 watch-notify.json > ~/.config/opencode/watch-notify.json > 默认 */
function loadConfig() {
  const candidates = [
    join(process.cwd(), "watch-notify.json"),
    join(homedir(), ".config", "opencode", "watch-notify.json"),
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const raw = JSON.parse(readFileSync(p, "utf-8"))
        return { notifySource: "opencode", hooks: parseSimpleConfig(raw) }
      } catch (err) {
        devLog("[配置]", `解析失败: ${p}`, String(err))
      }
    }
  }
  return DEFAULT_CONFIG
}

/* 小白傻瓜式 JSON → 内部 hooks 格式 */
/* 支持的顶级字段: gotify, desktop, webhook, smtp, cmd */
function parseSimpleConfig(raw) {
  const hooks = { onTaskComplete: [], onPermissionRequest: [] }

  function add(hook) {
    hooks.onTaskComplete.push(hook)
    hooks.onPermissionRequest.push({ ...hook })
  }

  /* ——— Gotify ——— */
  const g = raw.gotify
  if (g && g.url && g.token) {
    add({ type: "gotify", enabled: true, url: g.url, token: g.token, priority: g.priority ?? 5, title: "$TITLE", message: "$DETAILS" })
  }

  /* ——— 桌面通知 ——— */
  if (raw.desktop === true) {
    add({ type: "desktop", enabled: true, title: "$TITLE", message: "$DETAILS", urgency: "normal" })
  }

  /* ——— Webhook ——— */
  const w = raw.webhook
  if (w && w.url) {
    add({ type: "webhook", enabled: true, url: w.url, method: w.method ?? "POST", headers: w.headers ?? {}, template: w.template ?? null, timeout: w.timeout ?? 10000 })
  }

  /* ——— SMTP ——— */
  const s = raw.smtp
  if (s && s.host && s.user && s.pass) {
    add({
      type: "smtp", enabled: true, host: s.host, port: s.port ?? 587,
      secure: s.secure ?? false, auth: { user: s.user, pass: s.pass },
      from: s.from ?? s.user, to: Array.isArray(s.to) ? s.to : [s.to].filter(Boolean),
      subject: s.subject ?? "$TITLE", bodyTemplate: s.bodyTemplate ?? "$TITLE\\n$DETAILS",
    })
  }

  /* ——— 自定义命令 ——— */
  if (raw.cmd) {
    add({ type: "command", enabled: true, cmd: "/bin/sh", args: ["-c", raw.cmd], timeout: raw.cmdTimeout ?? 30000 })
  }

  devLog("[配置]", `解析完成: gotify=${!!g} desktop=${!!raw.desktop} webhook=${!!w} smtp=${!!s} cmd=${!!raw.cmd}`)
  return hooks
}

// ============================================================
// 变量替换
// ============================================================

function resolveVars(template, vars) {
  if (typeof template === "string") {
    return template.replace(/\$(\w+)/g, (_, key) => vars[key] ?? `$${key}`)
  }
  if (Array.isArray(template)) {
    return template.map(item => resolveVars(item, vars))
  }
  if (template !== null && typeof template === "object") {
    const result = {}
    for (const [k, v] of Object.entries(template)) result[k] = resolveVars(v, vars)
    return result
  }
  return template
}

// ============================================================
// Hook 执行器
// ============================================================

async function runCommand($, hook) {
  const { cmd, args = [], timeout = 30000 } = hook
  await $`${[cmd, ...args]}`.timeout(timeout).quiet()
}

async function runWebhook(hook) {
  const { url, method = "POST", headers = {}, template = null, timeout = 10000 } = hook
  const opts = { method, headers, signal: AbortSignal.timeout(timeout) }
  if (template && method !== "GET" && method !== "HEAD") {
    opts.body = JSON.stringify(template)
    if (!headers["Content-Type"]) opts.headers["Content-Type"] = "application/json"
  }
  const res = await fetch(url, opts)
  if (!res.ok) {
    throw new Error(`Webhook ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`)
  }
}

async function runDesktop($, hook) {
  const { title, message = "", urgency = "normal" } = hook
  const plat = process.platform
  if (plat === "linux") {
    await $`notify-send --urgency ${urgency} --app-name "Opencode" ${title} ${message}`.timeout(5000).quiet()
  } else if (plat === "darwin") {
    const safeMsg = message.replace(/"/g, '\\"')
    const safeTitle = title.replace(/"/g, '\\"')
    await $`osascript -e ${`display notification "${safeMsg}" with title "${safeTitle}"`}`.timeout(5000).quiet()
  }
}

async function runSmtp(hook) {
  const { host, port = 587, secure = false, auth, from, to, subject, bodyTemplate = "$TITLE\n$DETAILS" } = hook
  if (!host || !auth?.user || !auth?.pass || !from || !to?.length) {
    throw new Error("SMTP 配置不完整: 需要 host, auth, from, to")
  }

  const body = bodyTemplate.replace(/\\n/g, "\n")
  const mime = buildMime(from, to, subject, body)
  await sendMail(host, port, secure, auth, from, mime)
}

function buildMime(from, to, subject, body) {
  const h = [
    `From: ${from}`, `To: ${to.join(", ")}`, `Subject: ${subject}`,
    "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64", "",
    Buffer.from(body, "utf-8").toString("base64"),
  ].join("\r\n")
  return h + "\r\n.\r\n"
}

async function runGotify(hook) {
  const { url, token, priority = 5, title = "$TITLE", message = "$DETAILS" } = hook
  const apiUrl = `${url.replace(/\/+$/, "")}/message?token=${encodeURIComponent(token)}`
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, message, priority }),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    throw new Error(`Gotify ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`)
  }
}

function sendMail(host, port, secure, auth, from, message) {
  return new Promise((resolve, reject) => {
    let socket, step = 0, buffer = ""

    function send(cmd) { socket.write(cmd + "\r\n") }

    function onData(data) {
      buffer += data.toString()
      if (!buffer.endsWith("\r\n")) return
      const line = buffer.trim()
      buffer = ""

      if (step === 0 && line[0] === "2")          { step = 1; send("EHLO watch-notify") }
      else if (step === 1 && line.startsWith("250")) {
        if (!secure && port === 587)               { step = 2; send("STARTTLS") }
        else                                        { step = 3; send("AUTH LOGIN") }
      }
      else if (step === 2 && line.startsWith("220")) {
        socket.removeListener("data", onData)
        const tls = tlsConnect({ socket, host })
        socket = tls; step = 1; buffer = ""
        tls.on("data", onData)
        tls.write("EHLO watch-notify\r\n")
      }
      else if (step === 3 && line.startsWith("334")) { step = 4; send(Buffer.from(auth.user).toString("base64")) }
      else if (step === 4 && line.startsWith("334")) { step = 5; send(Buffer.from(auth.pass).toString("base64")) }
      else if (step === 5) {
        if (line[0] === "5") { reject(new Error(`SMTP 认证失败: ${line}`)); return }
        step = 6; send(`MAIL FROM:<${from}>`)
      }
      else if (step === 6 && line.startsWith("250")) { step = 7; send(`RCPT TO:<${to[0]}>`) }
      else if (step === 7 && line.startsWith("250")) { step = 8; send("DATA") }
      else if (step === 8 && line.startsWith("354")) { step = 9; send(message) }
      else if (step === 9 && line.startsWith("250")) { step = 10; send("QUIT"); resolve() }
    }

    socket = secure ? tlsConnect({ host, port }) : createConnection({ host, port })
    socket.on("connect", () => socket.on("data", onData))
    socket.on("error", reject)
    socket.setTimeout(15000)
    socket.on("timeout", () => { socket.destroy(); reject(new Error("SMTP 超时")) })
  })
}

// ============================================================
// 调度引擎
// ============================================================

async function dispatchHooks({ $, client, eventName, details, notificationTitle, runtime, sessionID, callerTTY }) {
  const start = Date.now()
  devLog("[事件]", { eventName, sessionID, title: notificationTitle })

  const config = loadConfig()
  const source = config.notifySource || "opencode"
  const label = { opencode: "Opencode", mimocode: "MiMoCode" }[source] || source
  devLog("[配置]", `来源=${source}`)

  const eventKey = eventName === "task-completed" ? "onTaskComplete"
    : eventName === "permission-request" ? "onPermissionRequest" : null
  if (!eventKey) { devLog("[跳过]", `未知事件: ${eventName}`); return }

  const hooks = config.hooks?.[eventKey]
  if (!hooks?.length) { devLog("[跳过]", `未配置 ${eventKey}`); return }

  devLog("[执行]", `事件=${eventKey} hook数量=${hooks.length}`)

  const vars = { SOURCE: source, SOURCE_LABEL: label, TITLE: notificationTitle, DETAILS: details, RUNTIME: runtime || "", TTY: callerTTY || "", SESSION_ID: sessionID }
  let ok = 0, fail = 0

  for (const hook of hooks) {
    if (!hook.enabled) { devLog("[Hook]", `类型=${hook.type} 状态=已禁用`); continue }

    const t = Date.now()
    devLog("[Hook]", `类型=${hook.type} 状态=开始执行`)
    try {
      const h = resolveVars(hook, vars)
      const runners = {
        command: () => runCommand($, h),
        webhook: () => runWebhook(h),
        desktop: () => runDesktop($, h),
        smtp: () => runSmtp(h),
        gotify: () => runGotify(h),
      }
      const runner = runners[hook.type]
      if (!runner) throw new Error(`未知 hook 类型: ${hook.type}`)
      await runner()
      devLog("[Hook]", `类型=${hook.type} 状态=成功 耗时=${Date.now() - t}ms`)
      ok++
    } catch (err) {
      devLog("[Hook]", `类型=${hook.type} 状态=失败 耗时=${Date.now() - t}ms`, String(err))
      await client.app.log({ body: { service: "watch-notify", level: "error", message: `Hook 失败: ${hook.type}`, extra: { error: String(err) } } })
      fail++
    }
  }

  devLog("[完成]", `总耗时=${Date.now() - start}ms 成功=${ok} 失败=${fail}`)
}

// ============================================================
// 插件导出
// ============================================================

const DUPLICATE_WINDOW_MS = 5000
const lastNotificationBySession = new Map()
const notifiedPermissions = new Set()

function getProcessTTY() {
  try {
    const tty = execFileSync("/bin/ps", ["-o", "tty=", "-p", String(process.pid)], { encoding: "utf8" }).trim()
    return tty && tty !== "??" && tty !== "?" ? `/dev/${tty}` : ""
  } catch { return "" }
}

function formatTaskTitle(title, label) {
  const n = title?.replace(/\s+/g, " ").trim()
  if (!n || n.startsWith("New session -")) return `${label} 任务完成`
  return `${label} 任务完成：${n.slice(0, 100)}`
}

function formatRuntime(startTime, endTime) {
  const diff = endTime - startTime
  if (diff < 1000) return "1秒以内"
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}小时${minutes % 60}分${seconds % 60}秒`
  if (minutes > 0) return `${minutes}分${seconds % 60}秒`
  return `${seconds}秒`
}

function formatTaskDetails(directory, runtime) {
  return [
    `项目：${directory}`,
    "状态：任务已完成，可以查看结果",
    runtime && `运行时间：${runtime}`,
  ].filter(Boolean).join("\n")
}

function formatPermissionDetails({ directory, sessionID, permission, pattern, title }) {
  return [
    `项目：${directory}`,
    `权限：${permission || "unknown"}`,
    `操作：${pattern || title || "未提供操作详情"}`,
    `会话：${sessionID}`,
  ].join("\n")
}

export const WatchNotificationPlugin = async ({ project, client, $, directory, worktree }) => {
  const source = process.env.NOTIFY_SOURCE || "opencode"
  const label = { opencode: "Opencode", mimocode: "MiMoCode" }[source] || source
  const iosTitle = process.env.MIMOCODE_IOS_SESSION_TITLE || process.env.OPENCODE_IOS_SESSION_TITLE || "iOS Chat"
  const processTTY = getProcessTTY()

  devLog("[插件]", `初始化完成 source=${source} directory=${directory}`)
  await client.app.log({ body: { service: "watch-notify", level: "info", message: `插件已加载 (${label})` } })

  return {
    event: async ({ event }) => {
      // ——— 权限申请 ———
      if (event.type === "permission.asked" || event.type === "permission.updated") {
        const p = event.properties
        const pid = p.id ?? p.requestID
        if (pid && notifiedPermissions.has(pid)) return
        if (pid) notifiedPermissions.add(pid)

        const pattern = Array.isArray(p.patterns ?? p.pattern) ? (p.patterns ?? p.pattern).join(", ") : (p.patterns ?? p.pattern ?? "")
        const details = formatPermissionDetails({
          directory,
          sessionID: p.sessionID,
          permission: p.permission ?? p.type ?? "unknown",
          pattern,
          title: p.title,
        })

        await dispatchHooks({ $, client, eventName: "permission-request", details, notificationTitle: `${label} 需要你批准操作`, sessionID: p.sessionID, callerTTY: "" })
        return
      }

      // ——— 任务完成（idle） ———
      const isIdle = event.type === "session.idle" || (event.type === "session.status" && event.properties.status.type === "idle")
      if (!isIdle) return

      const sessionID = event.properties.sessionID
      const now = Date.now()
      if (now - (lastNotificationBySession.get(sessionID) ?? 0) < DUPLICATE_WINDOW_MS) return
      lastNotificationBySession.set(sessionID, now)

      let title = `${label} 任务完成`
      let runtime = null

      try {
        const res = await client.session.get({ path: { id: sessionID }, query: { directory } })
        const s = res.data ?? res
        if (s?.title === iosTitle) return
        if (s?.parentID) return  /* 子代理 session 有 parentID，跳过通知，只由主 agent 触发 */
        title = formatTaskTitle(s?.title, label)
        if (s?.createdAt && s?.updatedAt) {
          runtime = formatRuntime(new Date(s.createdAt).getTime(), new Date(s.updatedAt).getTime())
        }
      } catch { /* 不阻塞通知 */ }

      const details = formatTaskDetails(directory, runtime)
      await dispatchHooks({ $, client, eventName: "task-completed", details, notificationTitle: title, runtime, sessionID, callerTTY: processTTY })
    },
  }
}
