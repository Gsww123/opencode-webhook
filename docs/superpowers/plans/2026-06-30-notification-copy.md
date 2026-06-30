# Notification Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化推送消息标题和正文，让用户能快速理解任务完成和权限申请通知。

**Architecture:** 在单文件插件中新增聚焦的文案格式化函数，事件处理只收集字段并调用这些函数。保持现有配置格式、渠道执行器、去重逻辑不变。

**Tech Stack:** 原生 JavaScript 模块、Node.js 标准库、现有自定义测试脚本。

---

## 文件结构

- 修改：`plugin/watch-notify.js`，新增文案格式化函数，并替换任务完成和权限申请的标题、正文生成。
- 修改：`test/test.js`，增强模拟 Shell 以记录命令，并增加新文案断言。
- 可选验证：`test/e2e-test.js` 不需要改动，只用于全链路人工观察。

### Task 1: 添加文案断言测试

**Files:**
- Modify: `test/test.js`

- [ ] **Step 1: 修改模拟 Shell，让测试能读取执行过的命令**

将 `mockShell` 改成带 `commands` 记录的函数对象：

```js
function mockShell() {
  const commands = []
  const shell = new Proxy(() => {}, {
    apply(target, thisArg, args) {
      const cmd = args[0]?.raw?.join(" ") || args.join(" ")
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
  return shell
}
```

- [ ] **Step 2: 新增任务完成文案测试**

在测试用例区域新增：

```js
async function testTaskCompleteCopy() {
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
  if (!output.includes("会话：copy-task")) throw new Error("任务完成正文缺少会话信息")
}
```

- [ ] **Step 3: 新增权限申请文案测试**

在测试用例区域新增：

```js
async function testPermissionCopy() {
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
}
```

- [ ] **Step 4: 注册新增测试**

在 `main()` 中追加：

```js
await runTest("任务完成文案", testTaskCompleteCopy)
await runTest("权限申请文案", testPermissionCopy)
```

- [ ] **Step 5: 运行测试确认失败**

Run: `node test/test.js`

Expected: 新增文案测试失败，提示标题或正文不符合新文案。

### Task 2: 实现通知文案格式化

**Files:**
- Modify: `plugin/watch-notify.js`

- [ ] **Step 1: 调整默认命令模板，让日志同时写入标题和正文**

将默认配置中的命令模板改为：

```js
args: ["-c", "printf '[%s] %s\\n%s\\n' \"$SOURCE\" \"$TITLE\" \"$DETAILS\" >> /tmp/opencode-notify.log"],
```

任务完成和权限申请两个默认命令都使用同样模板。

- [ ] **Step 2: 新增文案格式化函数**

在 `formatTitle` 附近替换为以下函数：

```js
function formatTaskTitle(title, label) {
  const n = title?.replace(/\s+/g, " ").trim()
  if (!n || n.startsWith("New session -")) return `${label} 任务完成`
  return `${label} 任务完成：${n.slice(0, 100)}`
}

function formatTaskDetails(directory, sessionID, callerTTY) {
  return [
    `项目：${directory}`,
    "状态：任务已完成，可以查看结果",
    `会话：${sessionID}`,
    callerTTY && `终端：${callerTTY}`,
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
```

- [ ] **Step 3: 替换权限申请事件文案生成**

将权限申请分支中的 `details` 和 `notificationTitle` 改为：

```js
const details = formatPermissionDetails({
  directory,
  sessionID: p.sessionID,
  permission: p.permission ?? p.type ?? "unknown",
  pattern,
  title: p.title,
})

await dispatchHooks({ $, client, eventName: "permission-request", details, notificationTitle: `${label} 需要你批准操作`, sessionID: p.sessionID, callerTTY: "" })
```

- [ ] **Step 4: 替换任务完成事件文案生成**

将任务完成分支中的 `details` 和 `title` 生成改为：

```js
let details = formatTaskDetails(directory, sessionID, processTTY)
let title = `${label} 任务完成`

try {
  const res = await client.session.get({ path: { id: sessionID }, query: { directory } })
  const s = res.data ?? res
  if (s?.title === iosTitle) return
  title = formatTaskTitle(s?.title, label)
} catch { /* 不阻塞通知 */ }
```

- [ ] **Step 5: 运行单元测试确认通过**

Run: `node test/test.js`

Expected: 所有测试通过。

### Task 3: 文档同步和全链路验证

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 更新变量示例**

将变量占位符表中的 `$TITLE` 示例改为：

```markdown
| `$TITLE` | 通知标题 | `Opencode 任务完成：代码重构` |
```

将 `$DETAILS` 示例改为：

```markdown
| `$DETAILS` | 通知详情 | `项目：/home/user/project` |
```

- [ ] **Step 2: 更新事件说明**

在事件说明表后追加：

```markdown
默认通知文案会区分两种状态：
- 任务完成：标题以“Opencode 任务完成”开头，正文包含项目、状态、会话和终端。
- 权限申请：标题为“Opencode 需要你批准操作”，正文包含项目、权限、操作和会话。
```

- [ ] **Step 3: 运行单元测试**

Run: `node test/test.js`

Expected: 所有测试通过。

- [ ] **Step 4: 运行端到端模拟测试**

Run: `node test/e2e-test.js`

Expected: 测试通过，通知日志中能看到新的中文标题和详情。

## 自检

规格覆盖：计划覆盖任务完成标题、任务完成正文、权限申请标题、权限申请正文、兼容性和测试。

占位符扫描：没有未定义的待办占位符。

类型一致性：新增函数只使用当前文件已有字段：`directory`、`sessionID`、`processTTY`、`p.permission`、`p.type`、`pattern`、`p.title`。
