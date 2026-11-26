/**
 * dsh-open-project — 宿主半边。
 *
 * 在输入框左侧提供一个【打开项目】徽标能打开的目标：每个对话（session）记住一个
 * 文件或文件夹的绝对路径，AI 用工具 open_project_target 设置它，用户点击徽标时
 * 由宿主机用系统默认方式打开（Windows 用 PowerShell Invoke-Item，macOS 用 open，
 * Linux 用 xdg-open），因此浏览器端不需要也不能直接启动本地程序。
 *
 * 状态存放在 $DSH_HOME/open-project.json，键是 session id：
 *   { "sessions": { "<sessionId>": { "path": "...", "source": "tool", "updatedAt": "..." } } }
 */

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export const name = 'dsh-open-project'

export const inject = ['webServer', 'tools']

const ROUTE_PREFIX = '/open-project'
const TARGET_ROUTE = '/open-project/target'
const OPEN_ROUTE = '/open-project/open'
const TOOL_NAME = 'open_project_target'
const STATE_FILE_NAME = 'open-project.json'
const IS_WINDOWS = process.platform === 'win32'
const MAX_BODY_BYTES = 64 * 1024
const ERROR_MARKER = 'OPEN-PROJECT-ERROR: '
const LAUNCH_WATCH_MS = 1500

function sessionIdOf(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function dshHome() {
  const explicit = process.env.DSH_HOME
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit.trim()
  return path.join(homedir(), '.dsh')
}

export function stateFilePath() {
  return path.join(dshHome(), STATE_FILE_NAME)
}

/**
 * 清理用户/AI 输入的路径文本，但先不做相对路径解析：
 * - 去掉首尾空白和成对引号
 * - 展开 ~ 与 ~/...
 * - 在 Windows 上接受 MSYS 风格的 /c/Users/...（等于 C:/Users/...）
 * 与 normalizePath 分开是因为“是否绝对路径”的判断必须发生在解析之前，
 * 否则相对路径会被 path.resolve 悄悄变成宿主 cwd 下的路径。
 */
export function cleanPathInput(input) {
  let value = String(input).trim()
  if (value.length >= 2) {
    const first = value.charAt(0)
    const last = value.charAt(value.length - 1)
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      value = value.slice(1, -1).trim()
    }
  }
  if (value === '~') {
    value = homedir()
  } else if (value.startsWith('~/') || value.startsWith('~' + path.sep)) {
    value = path.join(homedir(), value.slice(2))
  }
  if (IS_WINDOWS && /^\/[a-zA-Z](\/|$)/.test(value)) {
    const drive = value.charAt(1).toUpperCase()
    value = drive + ':' + (value.length > 2 ? value.slice(2) : '/')
  }
  return value
}

export function normalizePath(input) {
  return path.resolve(cleanPathInput(input))
}

function isAbsolutePath(value) {
  if (path.isAbsolute(value)) return true
  if (/^~([\\/]|$)/.test(value)) return true
  if (IS_WINDOWS) {
    if (/^[a-zA-Z]:[\\/]/.test(value)) return true
    if (/^\\\\/.test(value)) return true
    if (/^\/[a-zA-Z](\/|$)/.test(value)) return true
  }
  return false
}

async function readState() {
  let raw
  try {
    raw = await fs.readFile(stateFilePath(), 'utf8')
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return { sessions: {} }
    throw error
  }
  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { sessions: {} }
  }
  const sessions = parsed !== null && typeof parsed === 'object' && parsed.sessions !== null && typeof parsed.sessions === 'object' ? parsed.sessions : {}
  return { sessions }
}

async function renameWithRetry(from, to) {
  let lastError = null
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await fs.rename(from, to)
      return
    } catch (error) {
      lastError = error
      const code = error !== null && typeof error === 'object' ? error.code : undefined
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') break
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)))
    }
  }
  try {
    await fs.rm(to, { force: true })
  } catch (error) {
    // 目标不存在或无法删除时，下面的 rename 会给出真正的错误。
  }
  try {
    await fs.rename(from, to)
    return
  } catch (error) {
    throw error !== null && error !== undefined ? error : lastError
  }
}

async function writeState(state) {
  await fs.mkdir(dshHome(), { recursive: true })
  const target = stateFilePath()
  const temp = target + '.tmp-' + process.pid + '-' + Date.now()
  await fs.writeFile(temp, JSON.stringify(state, null, 2) + '\n', 'utf8')
  await renameWithRetry(temp, target)
}

async function probe(targetPath) {
  try {
    const stat = await fs.stat(targetPath)
    return { exists: true, kind: stat.isDirectory() ? 'folder' : 'file' }
  } catch (error) {
    return { exists: false, kind: null }
  }
}

function noTargetText() {
  return '这个对话还没有设置【打开项目】目标。请让 AI 调用 ' + TOOL_NAME + '（action: set, path: <文件或文件夹的绝对路径>）设置之后再试。'
}

export async function resolveTarget(sessionId) {
  const state = await readState()
  const record = state.sessions[sessionId]
  if (record === null || typeof record !== 'object' || typeof record.path !== 'string' || record.path === '') {
    return { sessionId, target: null }
  }
  const facts = await probe(record.path)
  return {
    sessionId,
    target: {
      path: record.path,
      kind: facts.kind,
      exists: facts.exists,
      source: typeof record.source === 'string' && record.source !== '' ? record.source : 'tool',
      updatedAt: typeof record.updatedAt === 'string' && record.updatedAt !== '' ? record.updatedAt : null,
    },
  }
}

export async function setTarget(sessionId, inputPath, source) {
  const state = await readState()
  state.sessions[sessionId] = {
    path: normalizePath(inputPath),
    source: typeof source === 'string' && source !== '' ? source : 'tool',
    updatedAt: new Date().toISOString(),
  }
  await writeState(state)
  return resolveTarget(sessionId)
}

export async function clearTarget(sessionId) {
  const state = await readState()
  if (state.sessions[sessionId] === undefined) return { sessionId, cleared: false }
  delete state.sessions[sessionId]
  await writeState(state)
  return { sessionId, cleared: true }
}

/** PowerShell 把错误写进重定向的 stderr 时会包成 CLIXML（<S S="Error">…</S>），
 *  这里取出真正的错误文本，免得徽标提示里显示一堆 XML。 */
export function cleanStderr(text) {
  if (typeof text !== 'string' || text.trim() === '') return ''
  const blocks = [...text.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map((match) => match[1])
  const raw = blocks.length > 0 ? blocks.join(' ') : text
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function quotePowerShell(value) {
  return "'" + String(value).replace(/'/g, "''") + "'"
}

/**
 * 返回打开目标所用的命令与参数。Windows 上统一交给 PowerShell 的 Start-Process：
 * 文件用默认程序打开，文件夹用资源管理器打开；直接 spawn explorer.exe 对文件夹
 * 并不可靠（DSH 自己的 open-in-app 也因此改走 shell）。
 */
export function launchCommandFor(targetPath, platform) {
  const os = platform === undefined ? process.platform : platform
  if (os === 'win32') {
    // 用 Invoke-Item 而不是 Start-Process：后者没有 -LiteralPath 参数，传路径会直接
    // 报 "A parameter cannot be found" 并退出 1。Invoke-Item 走 shell 关联，等同双击，
    // 文件用默认程序、文件夹用资源管理器，且支持 -LiteralPath（不做通配符展开）。
    const script =
      'try { Invoke-Item -LiteralPath ' +
      quotePowerShell(targetPath) +
      " -ErrorAction Stop } catch { Write-Output ('" +
      ERROR_MARKER +
      "' + $_.Exception.Message); exit 1 }"
    return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script]]
  }
  if (os === 'darwin') return ['open', [targetPath]]
  return ['xdg-open', [targetPath]]
}

/**
 * 启动打开命令：先观察 LAUNCH_WATCH_MS，命令仍在运行即视为成功（GUI 程序
 * 会常驻或把请求交给系统后退出），错误退出或 spawn 失败则报告启动器退出码。
 * stdio 用 ignore 而不是 pipe：带管道句柄的启动在受限环境里会 EPERM。
 * 不要用 detached: true —— Windows 上 Node 对它报告的退出码恒为 0，
 * 会把失败当成功；Start-Process/open/xdg-open 本身立即返回，无需分离。
 */
export async function launchDetached(targetPath, platform) {
  const pair = launchCommandFor(targetPath, platform)
  const command = pair[0]
  const args = pair[1]
  return await new Promise((resolve) => {
    let settled = false
    let timer = null
    let stderrText = ''
    let stdoutText = ''
    const finish = (result) => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      resolve(result)
    }
    const spawnError = (error) => ({
      ok: false,
      command,
      args,
      detail: '无法启动 ' + command + '：' + (error && error.message ? error.message : String(error)),
    })
    const start = (stdio) => spawn(command, args, { windowsHide: true, stdio })
    let child
    try {
      child = start(['ignore', 'pipe', 'pipe'])
    } catch (error) {
      // 受限环境里带管道句柄的启动可能 EPERM，退化成不收集 stderr 的启动。
      if (error && error.code === 'EPERM') {
        try {
          child = start('ignore')
        } catch (again) {
          finish(spawnError(again))
          return
        }
      } else {
        finish(spawnError(error))
        return
      }
    }
    if (child.stdout !== null && child.stdout !== undefined) {
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        stdoutText = (stdoutText + String(chunk)).slice(-800)
      })
    }
    if (child.stderr !== null && child.stderr !== undefined) {
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk) => {
        stderrText = (stderrText + String(chunk)).slice(-800)
      })
    }
    timer = setTimeout(() => {
      finish({ ok: true, command, args })
    }, LAUNCH_WATCH_MS)
    child.on('error', (error) => {
      finish(spawnError(error))
    })
    child.on('exit', (code, signal) => {
      if (code === 0 || code === null) {
        finish({ ok: true, command, args })
        return
      }
      const markerAt = stdoutText.indexOf(ERROR_MARKER)
      const tail = markerAt !== -1 ? stdoutText.slice(markerAt + ERROR_MARKER.length).trim().slice(0, 300) : cleanStderr(stderrText).slice(0, 300)
      finish({
        ok: false,
        command,
        args,
        detail: '启动器退出码 ' + String(code) + (signal ? '（signal ' + signal + '）' : '') + (tail !== '' ? '：' + tail : ''),
      })
    })
  })
}

export async function openTarget(sessionId) {
  const resolved = await resolveTarget(sessionId)
  const target = resolved.target
  if (target === null) {
    return { ok: false, code: 'no-target', text: noTargetText(), sessionId, target: null }
  }
  if (target.exists !== true) {
    return {
      ok: false,
      code: 'missing',
      text: '目标不存在：' + target.path + '。它可能已被移动或删除，请让 AI 用 ' + TOOL_NAME + ' 更新路径。',
      sessionId,
      target,
    }
  }
  const launched = await launchDetached(target.path)
  if (launched.ok !== true) {
    return {
      ok: false,
      code: 'launch-failed',
      text: '打开失败：' + target.path + '。' + (launched.detail !== undefined ? launched.detail : ''),
      sessionId,
      target,
    }
  }
  const kindText = target.kind === 'folder' ? '已在文件管理器中打开文件夹：' : '已用默认程序打开文件：'
  return {
    ok: true,
    code: 'opened',
    text: kindText + target.path,
    sessionId,
    target,
    command: launched.command,
    args: launched.args,
  }
}

function sameOriginOnly(req) {
  const headers = req !== null && typeof req === 'object' ? req.headers : null
  if (headers === null || typeof headers !== 'object') return false
  const site = headers['sec-fetch-site']
  if (typeof site === 'string' && site !== '' && site !== 'same-origin' && site !== 'none') return false
  const origin = headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  const host = headers.host
  if (typeof host !== 'string' || host === '') return false
  try {
    return new URL(origin).host === host
  } catch (error) {
    return false
  }
}

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'))
        if (typeof req.destroy === 'function') req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sessionFromUrl(req) {
  try {
    return sessionIdOf(new URL(req.url, 'http://localhost').searchParams.get('session'))
  } catch (error) {
    return ''
  }
}

/** 由 URL 尾部决定动作：/open-project/target 与 /open-project/open。 */
function routeAction(req, routePath) {
  if (typeof routePath === 'string' && routePath !== '') return routePath.replace(/^\/+/, '')
  try {
    const tail = new URL(req.url, 'http://localhost').pathname.slice(ROUTE_PREFIX.length).replace(/^\/+/, '')
    if (tail !== '') return tail
  } catch (error) {
    // URL 解析失败时退回按方法猜。
  }
  return req.method === 'GET' ? 'target' : 'open'
}

/**
 * 路由处理：GET /open-project/target?session=... 读取目标；
 * POST /open-project/open?session=... 打开目标。既是导出函数（便于测试），
 * 也通过 webServer 前缀路由接收界面请求。
 */
export async function handleRoute(req, res, routePath) {
  if (!sameOriginOnly(req)) {
    json(res, 403, { ok: false, code: 'forbidden', text: '只接受来自 DSH 界面的同源请求。' })
    return
  }
  const sessionId = sessionFromUrl(req)
  const action = routeAction(req, routePath)
  try {
    if (req.method === 'GET' && action === 'target') {
      if (sessionId === '') {
        json(res, 400, { ok: false, code: 'missing-session', text: '缺少对话标识（session）。' })
        return
      }
      const resolved = await resolveTarget(sessionId)
      json(res, 200, { ok: true, sessionId, target: resolved.target })
      return
    }
    if (req.method === 'POST' && action === 'target') {
      if (sessionId === '') {
        json(res, 400, { ok: false, code: 'missing-session', text: '缺少对话标识（session）。' })
        return
      }
      const rawBody = await readBody(req).catch(() => '')
      let body = null
      try {
        body = rawBody === '' ? null : JSON.parse(rawBody)
      } catch (error) {
        body = null
      }
      if (body === null || typeof body !== 'object') {
        json(res, 400, { ok: false, code: 'bad-body', text: '请求体必须是 JSON 对象。' })
        return
      }
      if (body.clear === true) {
        const cleared = await clearTarget(sessionId)
        json(res, 200, {
          ok: true,
          sessionId,
          target: null,
          cleared: cleared.cleared,
          text: cleared.cleared ? '已清除【打开项目】目标。' : '这个对话本来就没有设置目标。',
        })
        return
      }
      const rawPath = typeof body.path === 'string' ? body.path : ''
      if (rawPath.trim() === '') {
        json(res, 400, { ok: false, code: 'missing-path', text: '请填写要打开的文件或文件夹路径。' })
        return
      }
      const cleaned = cleanPathInput(rawPath)
      if (!isAbsolutePath(cleaned)) {
        json(res, 400, {
          ok: false,
          code: 'not-absolute',
          text: '需要绝对路径，例如 C:\\Project\\bin\\Debug\\App.exe、\\\\服务器\\共享\\项目 或 /home/me/project。',
        })
        return
      }
      const resolved = await setTarget(sessionId, cleaned, 'user')
      const target = resolved.target
      json(res, 200, {
        ok: true,
        sessionId,
        target,
        text:
          target !== null && target.exists === true
            ? '已设置【打开项目】目标：' + target.path
            : '已保存【打开项目】目标，但它当前不存在：' + (target !== null ? target.path : cleaned),
      })
      return
    }
    if (req.method === 'POST' && action === 'open') {
      if (sessionId === '') {
        json(res, 400, { ok: false, code: 'missing-session', text: '缺少对话标识（session）。' })
        return
      }
      await readBody(req).catch(() => '')
      const result = await openTarget(sessionId)
      json(res, 200, result)
      return
    }
    json(res, 404, { ok: false, code: 'unknown-route', text: '未知的 open-project 路由。' })
  } catch (error) {
    json(res, 500, {
      ok: false,
      code: 'internal-error',
      text: error !== null && error !== undefined && error.message !== undefined ? String(error.message) : String(error),
    })
  }
}

export function buildTool() {
  return {
    name: TOOL_NAME,
    description:
      '设置或读取当前对话的【打开项目】目标。用户在输入框左侧点击【打开项目】徽标时，会打开这里记录的文件或文件夹（文件用默认程序打开，文件夹用文件管理器打开）。完成工作、移动了产物位置（重新编译、改输出目录等）后，必须调用 action=set 把路径更新为最终文件或文件夹的绝对路径；用户不需要自己找 exe。action=set 设置目标；get 读取当前目标；clear 清除；open 立即打开。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['set', 'get', 'clear', 'open'],
          description: '要执行的动作，默认 set。',
        },
        path: {
          type: 'string',
          description: 'action=set 时必填：要打开的文件或文件夹的绝对路径，支持 ~ 与 Windows 上的 /c/... 写法。',
        },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [
        { type: 'text', text: value !== null && value !== undefined && typeof value.text === 'string' ? value.text : JSON.stringify(value) },
      ],
    },
    timeoutMs: 120000,
    async execute(args, exec) {
      const action = typeof args.action === 'string' && args.action !== '' ? args.action : 'set'
      const sessionId = exec !== undefined && exec.agent !== undefined && typeof exec.agent.id === 'string' ? sessionIdOf(exec.agent.id) : ''
      if (sessionId === '') {
        return { ok: false, text: '无法确定当前对话（exec.agent.id 不可用），没有做任何修改。' }
      }
      try {
        if (action === 'set') {
          const raw = typeof args.path === 'string' ? args.path.trim() : ''
          if (raw === '') {
            return { ok: false, text: 'action=set 需要 path：要打开的文件或文件夹的绝对路径。' }
          }
          const cleaned = cleanPathInput(raw)
          if (!isAbsolutePath(cleaned)) {
            return { ok: false, text: 'path 必须是绝对路径（例如 C:\\Project\\bin\\App.exe 或 /home/me/project）。收到：' + raw }
          }
          const resolved = await setTarget(sessionId, cleaned, 'tool')
          const target = resolved.target
          const exists = target !== null && target.exists === true
          const kindText = target !== null && target.kind === 'folder' ? '文件夹' : '文件'
          return {
            ok: true,
            action: 'set',
            sessionId,
            target,
            text: exists
              ? '已设置【打开项目】目标（' + kindText + '）：' + target.path + '。用户点击输入框左侧的【打开项目】徽标即可打开。'
              : '已保存【打开项目】目标：' + (target !== null ? target.path : raw) + '，但它当前不存在。确认产物生成后再调用一次 set 更新路径。',
          }
        }
        if (action === 'get') {
          const resolved = await resolveTarget(sessionId)
          const target = resolved.target
          return {
            ok: true,
            action: 'get',
            sessionId,
            target,
            text:
              target === null
                ? '当前对话还没有设置【打开项目】目标。'
                : '当前【打开项目】目标：' + target.path + '（' + (target.exists === true ? (target.kind === 'folder' ? '文件夹' : '文件') : '不存在') + '）',
          }
        }
        if (action === 'clear') {
          const result = await clearTarget(sessionId)
          return {
            ok: true,
            action: 'clear',
            sessionId,
            cleared: result.cleared,
            target: null,
            text: result.cleared ? '已清除【打开项目】目标。' : '当前对话本来就没有设置【打开项目】目标。',
          }
        }
        if (action === 'open') {
          const result = await openTarget(sessionId)
          return {
            ok: result.ok,
            action: 'open',
            sessionId,
            target: result.target,
            code: result.code,
            text: result.text,
          }
        }
        return { ok: false, text: '未知 action：' + action + '（可用 set/get/clear/open）。' }
      } catch (error) {
        return {
          ok: false,
          text: 'open_project_target 失败：' + (error !== null && error !== undefined && error.message !== undefined ? String(error.message) : String(error)),
        }
      }
    },
  }
}

export function apply(ctx) {
  ctx.effect(() => {
    const server = ctx.get('webServer')
    const dispose = server.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      async handler(req, res) {
        await handleRoute(req, res)
      },
    })
    return typeof dispose === 'function' ? () => dispose() : undefined
  }, 'dsh-open-project: routes')

  ctx.effect(() => {
    const tools = ctx.get('tools')
    const dispose = tools.register(buildTool())
    return typeof dispose === 'function' ? () => dispose() : undefined
  }, 'dsh-open-project: tool')
}
