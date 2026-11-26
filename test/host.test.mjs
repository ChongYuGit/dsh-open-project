import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const home = mkdtempSync(path.join(tmpdir(), 'dsh-open-project-test-'))
process.env.DSH_HOME = home

const plugin = await import('../index.js')

after(() => {
  try {
    rmSync(home, { recursive: true, force: true })
  } catch (error) {
    // 清理失败不影响测试结论。
  }
})

const folder = path.join(home, '产物 输出')
const exe = path.join(folder, 'App.exe')
mkdirSync(folder, { recursive: true })
writeFileSync(exe, 'stub')

function mountPlugin() {
  const captured = { route: null, tool: null }
  const ctx = {
    effect(fn) {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    get(service) {
      if (service === 'webServer') {
        return {
          register(entry) {
            captured.route = entry
            return () => {}
          },
        }
      }
      if (service === 'tools') {
        return {
          register(tool) {
            captured.tool = tool
            return () => {}
          },
        }
      }
      throw new Error('unexpected service ' + service)
    },
  }
  plugin.apply(ctx)
  return captured
}

function callRoute(route, options) {
  const opts = options ?? {}
  const method = opts.method ?? 'GET'
  const url = opts.url ?? '/open-project/target'
  const headers = Object.assign({ host: '127.0.0.1:56669' }, opts.headers ?? {})
  const chunks = opts.body === undefined ? [] : [Buffer.from(JSON.stringify(opts.body))]
  const req = {
    method,
    url,
    headers,
    on(event, handler) {
      if (event === 'data') chunks.forEach((chunk) => handler(chunk))
      if (event === 'end') handler()
      return req
    },
    destroy() {},
  }
  const out = { status: 0, headers: {}, text: '' }
  const res = {
    writeHead(status, responseHeaders) {
      out.status = status
      out.headers = responseHeaders ?? {}
    },
    end(text) {
      out.text = text ?? ''
    },
  }
  return route.handler(req, res).then(() => ({ ...out, json: JSON.parse(out.text) }))
}

test('set / get / clear 按对话隔离目标', async () => {
  const tool = mountPlugin().tool
  const setResult = await tool.execute({ action: 'set', path: '  "' + folder + '"  ' }, { agent: { id: 'session-a' } })
  assert.equal(setResult.ok, true, setResult.text)
  assert.equal(setResult.target.path, path.resolve(folder))
  assert.equal(setResult.target.kind, 'folder')
  assert.equal(setResult.target.exists, true)

  const getA = await tool.execute({ action: 'get' }, { agent: { id: 'session-a' } })
  assert.equal(getA.target.path, path.resolve(folder))

  const getB = await tool.execute({ action: 'get' }, { agent: { id: 'session-b' } })
  assert.equal(getB.target, null)

  const fileResult = await tool.execute({ action: 'set', path: exe }, { agent: { id: 'session-b' } })
  assert.equal(fileResult.target.kind, 'file')

  const cleared = await tool.execute({ action: 'clear' }, { agent: { id: 'session-b' } })
  assert.equal(cleared.cleared, true)

  const getB2 = await tool.execute({ action: 'get' }, { agent: { id: 'session-b' } })
  assert.equal(getB2.target, null)
})

test('拒绝相对路径，不写入状态', async () => {
  const tool = mountPlugin().tool
  const result = await tool.execute({ action: 'set', path: 'relative/app.exe' }, { agent: { id: 'session-rel' } })
  assert.equal(result.ok, false)
  assert.match(result.text, /绝对路径/)
  const read = await plugin.resolveTarget('session-rel')
  assert.equal(read.target, null)
})

test('缺少 exec.agent.id 时拒绝执行', async () => {
  const tool = mountPlugin().tool
  const result = await tool.execute({ action: 'set', path: folder }, {})
  assert.equal(result.ok, false)
  assert.match(result.text, /exec\.agent\.id/)
})

test('路由读取目标，打开不存在的目标返回 missing', async () => {
  const route = mountPlugin().route
  await plugin.setTarget('session-route', folder, 'tool')

  const read = await callRoute(route, { method: 'GET', url: '/open-project/target?session=session-route' })
  assert.equal(read.status, 200)
  assert.equal(read.json.ok, true)
  assert.equal(read.json.target.path, path.resolve(folder))

  await plugin.setTarget('session-missing', path.join(home, 'moved-away', 'gone.exe'), 'tool')
  const open = await callRoute(route, { method: 'POST', url: '/open-project/open?session=session-missing', body: {} })
  assert.equal(open.status, 200)
  assert.equal(open.json.ok, false)
  assert.equal(open.json.code, 'missing')
})

test('没有目标时打开返回 no-target', async () => {
  const route = mountPlugin().route
  const result = await callRoute(route, { method: 'POST', url: '/open-project/open?session=none', body: {} })
  assert.equal(result.json.ok, false)
  assert.equal(result.json.code, 'no-target')
})

test('界面设置路径：POST /open-project/target 保存与清除', async () => {
  const route = mountPlugin().route
  const saved = await callRoute(route, {
    method: 'POST',
    url: '/open-project/target?session=session-ui',
    body: { path: folder },
  })
  assert.equal(saved.status, 200)
  assert.equal(saved.json.ok, true)
  assert.equal(saved.json.target.path, path.resolve(folder))
  assert.equal(saved.json.target.kind, 'folder')
  assert.equal(saved.json.target.source, 'user')

  const get = await callRoute(route, { method: 'GET', url: '/open-project/target?session=session-ui' })
  assert.equal(get.json.target.path, path.resolve(folder))

  const clear = await callRoute(route, {
    method: 'POST',
    url: '/open-project/target?session=session-ui',
    body: { clear: true },
  })
  assert.equal(clear.status, 200)
  assert.equal(clear.json.ok, true)
  assert.equal(clear.json.target, null)
  assert.equal(clear.json.cleared, true)
})

test('界面设置路径时拒绝相对路径、空路径与缺 session', async () => {
  const route = mountPlugin().route
  const relative = await callRoute(route, {
    method: 'POST',
    url: '/open-project/target?session=session-ui-bad',
    body: { path: 'bin/app.exe' },
  })
  assert.equal(relative.status, 400)
  assert.equal(relative.json.code, 'not-absolute')

  const empty = await callRoute(route, {
    method: 'POST',
    url: '/open-project/target?session=session-ui-bad',
    body: { path: '   ' },
  })
  assert.equal(empty.status, 400)
  assert.equal(empty.json.code, 'missing-path')

  const noSession = await callRoute(route, { method: 'POST', url: '/open-project/target', body: { path: folder } })
  assert.equal(noSession.status, 400)
  assert.equal(noSession.json.code, 'missing-session')

  const state = await plugin.resolveTarget('session-ui-bad')
  assert.equal(state.target, null)
})

test('跨站请求被拒绝', async () => {
  const route = mountPlugin().route
  const result = await callRoute(route, {
    method: 'GET',
    url: '/open-project/target?session=x',
    headers: { 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(result.status, 403)
  assert.equal(result.json.code, 'forbidden')
})

test('各平台启动命令', () => {
  const windows = plugin.launchCommandFor("C:\\a b\\it's.exe", 'win32')
  assert.equal(windows[0], 'powershell.exe')
  const script = windows[1][windows[1].length - 1]
  assert.match(script, /Invoke-Item -LiteralPath /)
  assert.match(script, /'C:\\a b\\it''s\.exe'/)
  assert.deepEqual(plugin.launchCommandFor('/tmp/x', 'darwin'), ['open', ['/tmp/x']])
  assert.deepEqual(plugin.launchCommandFor('/tmp/x', 'linux'), ['xdg-open', ['/tmp/x']])
})

test('normalizePath 处理引号、波浪号与 MSYS 盘符', () => {
  assert.equal(plugin.normalizePath('  "' + home + '"  '), path.resolve(home))
  if (process.platform === 'win32') {
    assert.equal(plugin.normalizePath('/c/Users/me/project'), path.resolve('C:/Users/me/project'))
  }
})
