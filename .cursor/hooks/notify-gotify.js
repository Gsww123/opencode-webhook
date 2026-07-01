/**
 * Cursor Hook 共享脚本：推送 Gotify 通知
 *
 * 从 stdin 读取 hook 事件 JSON，向 Gotify 推送通知。
 * stderr 输出日志，stdout 输出协议 JSON。
 *
 * 配置从 .cursor/watch-notify.json 读取（gotify 段）。
 * 支持自定义消息模板 title_template / message_template，
 * 模板变量使用 {varname} 格式。
 */
const fs = require('fs')
const path = require('path')

// ===== 读取配置 =====
// 配置文件位于 hooks 目录的上级 .cursor/ 中
const configPath = path.resolve(__dirname, '../watch-notify.json')
let config
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
} catch (err) {
  console.error('[hook:gotify] 无法读取配置:', err.message)
  console.log(JSON.stringify({ continue: true }))
  process.exit(0)
}

const gotifyCfg = config.gotify || {}
const GOTIFY_URL = gotifyCfg.url
const GOTIFY_TOKEN = gotifyCfg.token
const PRIORITY = gotifyCfg.priority ?? 5
const title_template = gotifyCfg.title_template
const message_template = gotifyCfg.message_template

function log(...args) {
  console.error('[hook:gotify]', ...args)
}

// ===== 会话存储（跨事件共享会话元数据）=====
const SESSION_STORE_PATH = path.resolve(__dirname, 'state/sessions.json')

function readSessionStore() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_STORE_PATH, 'utf-8'))
  } catch { return {} }
}

function writeSessionStore(store) {
  const dir = path.dirname(SESSION_STORE_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(SESSION_STORE_PATH, JSON.stringify(store, null, 2), 'utf-8')
}

/** 清理超过 24 小时的旧会话记录 */
function cleanupSessionStore(store, maxAgeMs = 24 * 60 * 60 * 1000) {
  const now = Date.now()
  for (const [k, v] of Object.entries(store)) {
    if (now - new Date(v.startedAt).getTime() > maxAgeMs) delete store[k]
  }
}

// ===== 事件标题映射 =====
const TITLE_MAP = {
  sessionStart:          '🤖 Cursor Agent 会话开始',
  sessionEnd:            '🤖 Cursor Agent 会话结束',
  beforeShellExecution:  '💻 执行命令',
  afterShellExecution:   '✅ 命令执行完毕',
  afterFileEdit:         '📝 文件已编辑',
  stop:                  '⏹  Agent 已停止',
  subagentStart:         '🔧 SubAgent 启动',
  subagentStop:          '🔧 SubAgent 结束',
  postToolUse:           '🛠  工具调用',
  postToolUseFailure:    '❌ 工具调用失败',
  beforeReadFile:        '📖 读取文件',
  preCompact:            '📦 上下文压缩',
  afterAgentResponse:    '💬 Agent 回复完毕',
  afterAgentThought:     '🤔 Agent 思考中',
}

// 模型标识符直接使用原始值，不做美化映射（用户需要看到真实模型标识符）

// ===== 状态中英文映射 =====
const STATUS_CN_MAP = {
  completed: '已完成',
  success:   '成功',
  failed:    '失败',
  aborted:   '已中止',
  error:     '出错',
  cancelled: '已取消',
  timeout:   '超时',
  running:   '运行中',
  pending:   '等待中',
  skipped:   '已跳过',
  denied:    '已拒绝',
  allowed:   '已允许',
}

// ===== 模板变量收集 =====
function collectVars(input) {
  const eventName = input.hook_event_name || 'unknown'

  // 模型：直接使用原始标识符，不做任何美化映射
  let rawModel = input.model || input.model_id || input.model_name || ''

  // 会话标识
  const convId = input.conversation_id || ''
  let convDisplay = input.conversation_title || input.title || ''

  // 对于 stop 事件，sessionStart 提供的信息更准确，尝试从存储读取
  if (eventName === 'stop' && convId) {
    const store = readSessionStore()
    const session = store[convId]
    if (session) {
      if (!convDisplay && session.title) convDisplay = session.title
      if (!rawModel || rawModel === 'unknown') {
        rawModel = session.model || rawModel
      }
    }
  }

  const convLabel = convDisplay || convId.slice(0, 12) || '(无会话)'

  return {
    event_name:    eventName,
    event_title:   TITLE_MAP[eventName] || `🔔 Cursor Hook: ${eventName}`,
    cwd:           input.cwd || '',
    cwd_basename:  input.cwd ? path.basename(input.cwd) : '',
    conversation:  convLabel,
    conversation_id: convId,
    conversation_title: convDisplay || convId,
    command:       input.command || '',
    tool:          input.tool_name || '',
    file:          input.file_path || input.path || '',
    model:         rawModel || '未知',
    model_raw:     rawModel,
    status:        input.status || '',
    status_cn:     STATUS_CN_MAP[input.status] || input.status || '',
    subagent:      input.subagent_type || '',
    error:         (input.error || input.failure_message || '').slice(0, 200),
    time:          new Date().toLocaleTimeString('zh-CN', { hour12: false }),
  }
}

// ===== 模板渲染 =====
function renderTemplate(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] !== undefined ? String(vars[key]) : `{${key}}`
  )
}

// ===== 默认详情组装（向后兼容，cwd 使用 basename） =====
function formatDefaultMessage(input) {
  const vars = collectVars(input)
  const lines = []
  // 项目名用最后一级目录，简洁明了
  if (vars.cwd_basename) {
    lines.push(`项目：${vars.cwd_basename}`)
  }
  if (vars.conversation) {
    lines.push(`会话：${vars.conversation}`)
  }
  if (vars.command) {
    lines.push(`命令：${vars.command.slice(0, 200)}`)
  }
  if (vars.tool) {
    lines.push(`工具：${vars.tool}`)
  }
  if (vars.file) {
    lines.push(`文件：${vars.file}`)
  }
  if (vars.model) {
    lines.push(`模型：${vars.model}`)
  }
  if (vars.status) {
    lines.push(`状态：${vars.status_cn}`)
  }
  if (vars.subagent) {
    lines.push(`SubAgent：${vars.subagent}`)
  }
  if (vars.error) {
    lines.push(`错误：${vars.error.slice(0, 200)}`)
  }
  return lines.join('\n') || '(无详细信息)'
}

// ===== 发送 Gotify 通知 =====
async function sendGotify(title, message) {
  const url = `${GOTIFY_URL}/message?token=${encodeURIComponent(GOTIFY_TOKEN)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, message, priority: PRIORITY }),
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Gotify ${res.status}: ${text.slice(0, 100)}`)
  }
}

// ===== 主逻辑 =====
function main(raw) {
  // 去除可能存在的 BOM 字符
  const input = JSON.parse(raw.replace(/^\uFEFF/, ''))

  // 调试日志：记录原始事件，方便排查字段名
  log('收到事件:', input.hook_event_name, 'conversation_id=', (input.conversation_id || '').slice(0, 12))
  log('原始数据(前500):', JSON.stringify(input).slice(0, 500))

  // sessionStart：存储会话元数据（名称、模型），供后续事件使用
  if (input.hook_event_name === 'sessionStart') {
    const convId = input.conversation_id
    if (convId) {
      const store = readSessionStore()
      cleanupSessionStore(store)
      store[convId] = {
        title: input.conversation_title || input.title || '',
        model: input.model || '',
        startedAt: new Date().toISOString(),
      }
      writeSessionStore(store)
      log('会话信息已存储:', convId.slice(0, 8), '标题:', store[convId].title)
    }
    console.log(JSON.stringify({ continue: true }))
    return
  }

  const vars = collectVars(input)

  // 标题：优先使用自定义模板，否则用 TITLE_MAP
  const title = title_template
    ? renderTemplate(title_template, vars)
    : vars.event_title

  // 消息体：优先使用自定义模板，否则用默认组装
  const message = message_template
    ? renderTemplate(message_template, vars)
    : formatDefaultMessage(input)

  log(`事件=${vars.event_name} 标题="${title}"`)

  sendGotify(title, message)
    .then(() => {
      log('推送成功')
      console.log(JSON.stringify({ continue: true }))
    })
    .catch((err) => {
      log('推送失败:', err.message)
      console.log(JSON.stringify({ continue: true }))
    })
}

// ===== 入口：收集 stdin =====
let buf = ''
process.stdin.setEncoding('utf-8')
process.stdin.on('data', (chunk) => (buf += chunk))
process.stdin.on('end', () => {
  try {
    main(buf)
  } catch (err) {
    log('脚本异常:', err.message)
    console.log(JSON.stringify({ continue: true }))
  }
})