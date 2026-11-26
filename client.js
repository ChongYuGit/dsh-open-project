/**
 * dsh-open-project — 浏览器半边。
 *
 * 在输入框左侧工具行渲染【打开项目】徽标：点击让宿主打开这个对话的目标文件/文件夹。
 * 目标是 AI 通过宿主工具 open_project_target 设置的；这里定时读取 /open-project/target，
 * 点击时 POST /open-project/open。宿主负责真正的系统级启动。
 */

window.__ModuleLoader__.load({
  id: 'dsh-open-project',
  factory(require) {
    const react = require('react')
    const h = react.createElement

    const NS = 'open-project'
    const ENTRY_ID = 'open-project.launch'
    const TARGET_PATH = '/open-project/target'
    const OPEN_PATH = '/open-project/open'
    const POLL_INTERVAL_MS = 5000
    const REQUEST_TIMEOUT_MS = 4000
    const FEEDBACK_MS = 4000

    // Only the left composer seat: the right/dock seats render extra copies (the dock
    // one as a full-width row above the conversation), so one badge is all we register.
    const SEATS = [{ name: 'conversation.input.left', order: 40 }]

    const COPY = {
      zh: {
        name: '打开项目',
        'badge.label': '打开项目',
        'badge.opening': '打开中…',
        'badge.opened': '已打开',
        'badge.failed': '打开失败',
        'badge.unset': '未设置目标',
        'tip.target': '点击打开：',
        'tip.folder': '（文件夹，将在文件管理器中打开）',
        'tip.missing': '（目标当前不存在，AI 可能需要更新路径）',
        'tip.none': '这个对话还没有目标。点击这里手动设置路径，或让 AI 调用 open_project_target 设置。',
        'tip.opening': '正在打开目标…',
        'tip.edit': '设置 / 修改要打开的文件或文件夹（也可在徽标上点右键）',
        'feedback.failed': '打开失败，请查看 AI 是否更新了路径。',
        'feedback.missing-session': '缺少对话标识，无法打开。',
        'editor.title': '设置【打开项目】目标',
        'editor.current': '当前：',
        'editor.none': '（未设置）',
        'editor.placeholder': '粘贴绝对路径：exe、文件或文件夹',
        'editor.hint': '支持 C:\\目录\\App.exe、\\\\服务器\\共享\\目录、~/目录 与 /c/目录 写法。',
        'editor.save': '保存',
        'editor.saveOpen': '保存并打开',
        'editor.clear': '清除',
        'editor.cancel': '取消',
        'editor.close': '关闭',
        'editor.saved': '已保存。',
        'editor.cleared': '已清除。',
        'editor.empty': '请先填写路径。',
        'editor.invalid': '需要绝对路径。',
        'editor.failed': '保存失败，请重试。',
        'editor.notExist': '已保存，但这个路径当前不存在，确认产物生成后再更新。',
      },
      en: {
        name: 'Open project',
        'badge.label': 'Open project',
        'badge.opening': 'Opening…',
        'badge.opened': 'Opened',
        'badge.failed': 'Open failed',
        'badge.unset': 'No target',
        'tip.target': 'Click to open: ',
        'tip.folder': ' (folder, opens in the file manager)',
        'tip.missing': ' (target does not exist right now; the AI may need to update the path)',
        'tip.none': 'This conversation has no target yet. Click here to set a path, or have the AI call open_project_target.',
        'tip.opening': 'Opening the target…',
        'tip.edit': 'Set / change the file or folder to open (or right-click the badge)',
        'feedback.failed': 'Open failed. Check that the AI updated the path.',
        'feedback.missing-session': 'No conversation id, cannot open.',
        'editor.title': 'Set the open-project target',
        'editor.current': 'Current: ',
        'editor.none': '(none)',
        'editor.placeholder': 'Paste an absolute path: exe, file or folder',
        'editor.hint': 'Accepts C:\\dir\\App.exe, \\\\server\\share\\dir, ~/dir and /c/dir forms.',
        'editor.save': 'Save',
        'editor.saveOpen': 'Save and open',
        'editor.clear': 'Clear',
        'editor.cancel': 'Cancel',
        'editor.close': 'Close',
        'editor.saved': 'Saved.',
        'editor.cleared': 'Cleared.',
        'editor.empty': 'Enter a path first.',
        'editor.invalid': 'An absolute path is required.',
        'editor.failed': 'Save failed, try again.',
        'editor.notExist': 'Saved, but this path does not exist right now. Update it once the build output exists.',
      },
    }

    const EDITOR_WIDTH = 340

    const BADGE_GROUP_STYLE = {
      display: 'inline-flex',
      alignItems: 'center',
      height: '22px',
      borderRadius: '999px',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'transparent',
      whiteSpace: 'nowrap',
    }

    const BADGE_BUTTON_STYLE = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      height: '20px',
      padding: '0 4px 0 8px',
      margin: '0',
      border: 'none',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      font: 'inherit',
      fontSize: '11px',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      transition: 'color 120ms ease',
    }

    const CARET_STYLE = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '18px',
      height: '20px',
      padding: '0',
      border: 'none',
      borderLeft: '1px solid var(--dsw-alias-border-l2)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      font: 'inherit',
      fontSize: '10px',
      lineHeight: '1',
      cursor: 'pointer',
    }

    const EDITOR_STYLE = {
      position: 'fixed',
      width: EDITOR_WIDTH + 'px',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      padding: '10px',
      borderRadius: '10px',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-overlay)',
      color: 'var(--dsw-alias-label-primary)',
      boxShadow: '0 10px 28px rgba(0, 0, 0, 0.22)',
      font: 'inherit',
      fontSize: '12px',
      lineHeight: '1.4',
      zIndex: 2147483000,
      textAlign: 'left',
    }

    const EDITOR_INPUT_STYLE = {
      width: '100%',
      height: '28px',
      boxSizing: 'border-box',
      padding: '0 8px',
      borderRadius: '6px',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: '11px',
    }

    const EDITOR_BUTTON_STYLE = {
      appearance: 'none',
      height: '26px',
      padding: '0 10px',
      borderRadius: '6px',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: '11px',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    }

    const EDITOR_PRIMARY_STYLE = Object.assign({}, EDITOR_BUTTON_STYLE, {
      background: 'var(--dsw-alias-brand-primary)',
      borderColor: 'var(--dsw-alias-brand-primary)',
      color: '#fff',
    })

    function FolderIcon(props) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 12,
          height: 12,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          style: { display: 'block', width: '12px', height: '12px', flex: '0 0 auto', color: props.tint },
        },
        h('path', {
          d: 'M1.9 4.4h4.05l1.45 1.65h6.7v6.2a1 1 0 0 1-1 1H2.9a1 1 0 0 1-1-1V4.4Z',
        }),
      )
    }

    function sessionPath(base, sessionId) {
      if (sessionId === '') return base
      return base + '?session=' + encodeURIComponent(sessionId)
    }

    function fetchJson(url, options, timeoutMs) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      const timer = controller === null ? null : setTimeout(() => controller.abort(), timeoutMs)
      const request = Object.assign(
        { credentials: 'same-origin', headers: { accept: 'application/json' }, cache: 'no-store' },
        options,
      )
      if (controller !== null) request.signal = controller.signal
      return fetch(url, request)
        .then(async (response) => {
          let payload = null
          try {
            payload = await response.json()
          } catch (error) {
            payload = null
          }
          return { response, payload }
        })
        .finally(() => {
          if (timer !== null) clearTimeout(timer)
        })
    }

    function OpenProjectBadge(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
      const [target, setTarget] = react.useState(null)
      const [opening, setOpening] = react.useState(false)
      const [feedback, setFeedback] = react.useState(null)
      const [editorOpen, setEditorOpen] = react.useState(false)
      const [draft, setDraft] = react.useState('')
      const [saving, setSaving] = react.useState(false)
      const [editorMessage, setEditorMessage] = react.useState(null)
      const [anchor, setAnchor] = react.useState({ left: 8, top: 80 })
      const alive = react.useRef(true)
      const reading = react.useRef(false)
      const root = react.useRef(null)
      const input = react.useRef(null)

      react.useEffect(() => {
        alive.current = true
        return () => {
          alive.current = false
        }
      }, [])

      const read = react.useCallback(async () => {
        if (reading.current || sessionId === '') return
        reading.current = true
        try {
          const result = await fetchJson(sessionPath(TARGET_PATH, sessionId), { method: 'GET' }, REQUEST_TIMEOUT_MS)
          if (!alive.current) return
          const payload = result.payload
          if (result.response.ok && payload !== null && payload.ok === true) {
            setTarget(payload.target !== null && payload.target !== undefined ? payload.target : null)
          }
        } catch (error) {
          // 读取失败时保留上一次的目标，界面不闪。
        } finally {
          reading.current = false
        }
      }, [sessionId])

      react.useEffect(() => {
        void read()
        const timer = setInterval(() => {
          if (typeof document !== 'undefined' && document.hidden === true) return
          void read()
        }, POLL_INTERVAL_MS)
        const onVisible = () => {
          if (typeof document === 'undefined' || document.hidden === false) void read()
        }
        if (typeof document !== 'undefined') {
          document.addEventListener('visibilitychange', onVisible)
          document.addEventListener('focus', onVisible)
        }
        return () => {
          clearInterval(timer)
          if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', onVisible)
            document.removeEventListener('focus', onVisible)
          }
        }
      }, [read])

      react.useEffect(() => {
        if (feedback === null) return undefined
        const timer = setTimeout(() => {
          if (alive.current) setFeedback(null)
        }, FEEDBACK_MS)
        return () => clearTimeout(timer)
      }, [feedback])

      react.useEffect(() => {
        if (editorOpen !== true) return undefined
        const timer = setTimeout(() => {
          if (input.current !== null && typeof input.current.focus === 'function') input.current.focus()
        }, 0)
        return () => clearTimeout(timer)
      }, [editorOpen])

      // 编辑浮层打开时：点外面或按 Esc 关闭。root 同时包住徽标和浮层，
      // 所以在浮层内部点击不会被当成“点外面”。
      react.useEffect(() => {
        if (editorOpen !== true) return undefined
        const onPointerDown = (event) => {
          const node = root.current
          if (node !== null && typeof node.contains === 'function' && node.contains(event.target)) return
          setEditorOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setEditorOpen(false)
        }
        document.addEventListener('mousedown', onPointerDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('mousedown', onPointerDown)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [editorOpen])

      const open = react.useCallback(async () => {
        if (opening) return
        if (sessionId === '') {
          setFeedback({ kind: 'error', code: 'missing-session', text: t('feedback.missing-session') })
          return
        }
        setOpening(true)
        setFeedback(null)
        try {
          const result = await fetchJson(
            sessionPath(OPEN_PATH, sessionId),
            {
              method: 'POST',
              headers: { accept: 'application/json', 'content-type': 'application/json' },
              body: '{}',
            },
            REQUEST_TIMEOUT_MS,
          )
          if (!alive.current) return
          const payload = result.payload
          if (result.response.ok && payload !== null && payload.ok === true) {
            if (payload.target !== null && payload.target !== undefined) setTarget(payload.target)
            setFeedback({ kind: 'ok', text: '' })
            return
          }
          const text =
            payload !== null && typeof payload.text === 'string' && payload.text !== '' ? payload.text : t('feedback.failed')
          const code = payload !== null && typeof payload.code === 'string' ? payload.code : 'failed'
          setFeedback({ kind: 'error', code, text })
          void read()
        } catch (error) {
          if (alive.current) setFeedback({ kind: 'error', code: 'failed', text: t('feedback.failed') })
        } finally {
          if (alive.current) setOpening(false)
        }
      }, [opening, sessionId, t, read])

      const openEditor = react.useCallback(() => {
        if (sessionId === '') {
          setFeedback({ kind: 'error', code: 'missing-session', text: t('feedback.missing-session') })
          return
        }
        const rect =
          root.current !== null && typeof root.current.getBoundingClientRect === 'function'
            ? root.current.getBoundingClientRect()
            : null
        const viewportWidth = typeof window !== 'undefined' ? window.innerWidth || 1200 : 1200
        const viewportHeight = typeof window !== 'undefined' ? window.innerHeight || 800 : 800
        const width = Math.min(EDITOR_WIDTH, Math.max(240, viewportWidth - 16))
        const left = rect === null ? 8 : Math.max(8, Math.min(rect.left, viewportWidth - width - 8))
        const above = rect !== null && rect.top > 300
        setAnchor(
          rect === null
            ? { left, top: 80 }
            : above
              ? { left, bottom: viewportHeight - rect.top + 6 }
              : { left, top: rect.bottom + 6 },
        )
        setDraft(target !== null && typeof target.path === 'string' ? target.path : '')
        setEditorMessage(null)
        setEditorOpen(true)
      }, [sessionId, t, target])

      const saveEditor = react.useCallback(
        async (andOpen) => {
          if (saving) return
          const value = draft.trim()
          if (value === '') {
            setEditorMessage({ kind: 'error', text: t('editor.empty') })
            return
          }
          setSaving(true)
          setEditorMessage(null)
          try {
            const result = await fetchJson(
              sessionPath(TARGET_PATH, sessionId),
              {
                method: 'POST',
                headers: { accept: 'application/json', 'content-type': 'application/json' },
                body: JSON.stringify({ path: value }),
              },
              REQUEST_TIMEOUT_MS,
            )
            if (!alive.current) return
            const payload = result.payload
            if (!result.response.ok || payload === null || payload.ok !== true) {
              const text =
                payload !== null && typeof payload.text === 'string' && payload.text !== ''
                  ? payload.text
                  : t('editor.invalid')
              setEditorMessage({ kind: 'error', text })
              return
            }
            const saved = payload.target !== null && payload.target !== undefined ? payload.target : null
            const missing = saved !== null && saved.exists === false
            setTarget(saved)
            setEditorMessage({
              kind: missing ? 'error' : 'ok',
              text: missing ? t('editor.notExist') : t('editor.saved'),
            })
            // 路径当前不存在时把浮层留在打开状态，让用户直接改；否则收起。
            if (missing !== true) setEditorOpen(false)
            if (andOpen === true && missing !== true) await open()
          } catch (error) {
            if (alive.current) setEditorMessage({ kind: 'error', text: t('editor.failed') })
          } finally {
            if (alive.current) setSaving(false)
          }
        },
        [draft, open, saving, sessionId, t],
      )

      const clearEditor = react.useCallback(async () => {
        if (saving) return
        setSaving(true)
        setEditorMessage(null)
        try {
          const result = await fetchJson(
            sessionPath(TARGET_PATH, sessionId),
            {
              method: 'POST',
              headers: { accept: 'application/json', 'content-type': 'application/json' },
              body: JSON.stringify({ clear: true }),
            },
            REQUEST_TIMEOUT_MS,
          )
          if (!alive.current) return
          const payload = result.payload
          if (!result.response.ok || payload === null || payload.ok !== true) {
            setEditorMessage({ kind: 'error', text: t('editor.failed') })
            return
          }
          setTarget(null)
          setDraft('')
          setEditorOpen(false)
          setFeedback(null)
        } catch (error) {
          if (alive.current) setEditorMessage({ kind: 'error', text: t('editor.failed') })
        } finally {
          if (alive.current) setSaving(false)
        }
      }, [saving, sessionId, t])

      const state = opening
        ? 'opening'
        : feedback !== null
          ? feedback.kind === 'error' ? 'error' : 'ok'
          : target !== null ? (target.exists === false ? 'stale' : 'ready') : 'unset'
      let label = t('badge.label')
      if (opening) label = t('badge.opening')
      else if (feedback !== null && feedback.kind === 'error') label = feedback.code === 'no-target' ? t('badge.unset') : t('badge.failed')
      else if (feedback !== null && feedback.kind === 'ok') label = t('badge.opened')

      let tip = t('tip.none')
      if (opening) tip = t('tip.opening')
      else if (feedback !== null && typeof feedback.text === 'string' && feedback.text !== '') tip = feedback.text
      else if (target !== null) {
        const missing = target.exists === false ? t('tip.missing') : ''
        tip = t('tip.target') + '\n' + target.path + (target.kind === 'folder' ? t('tip.folder') : '') + missing
      }
      tip = tip + '\n' + t('tip.edit')

      const tone =
        state === 'error'
          ? 'var(--dsw-alias-state-error-primary)'
          : state === 'ok'
            ? 'var(--dsw-alias-state-success-primary)'
            : state === 'stale'
              ? 'var(--dsw-alias-state-warn-primary)'
              : 'var(--dsw-alias-label-secondary)'
      const iconTint =
        state === 'error' || state === 'stale'
          ? tone
          : target !== null
            ? 'var(--dsw-alias-brand-primary)'
            : 'currentColor'

      const editor =
        editorOpen !== true
          ? null
          : h(
              'div',
              {
                style: Object.assign({}, EDITOR_STYLE, anchor),
                role: 'dialog',
                'aria-label': t('editor.title'),
                'data-open-project-editor': 'true',
              },
              [
                h(
                  'div',
                  { key: 'head', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' } },
                  [
                    h('span', { key: 'title', style: { fontWeight: 600 } }, t('editor.title')),
                    h(
                      'button',
                      {
                        key: 'close',
                        type: 'button',
                        title: t('editor.close'),
                        'aria-label': t('editor.close'),
                        onClick: () => setEditorOpen(false),
                        style: Object.assign({}, EDITOR_BUTTON_STYLE, {
                          height: '20px',
                          padding: '0 6px',
                          border: 'none',
                          background: 'transparent',
                          color: 'var(--dsw-alias-label-secondary)',
                          fontSize: '13px',
                        }),
                      },
                      '×',
                    ),
                  ],
                ),
                h(
                  'div',
                  { key: 'current', style: { color: 'var(--dsw-alias-label-secondary)', overflowWrap: 'anywhere' } },
                  t('editor.current') + (target !== null && typeof target.path === 'string' ? target.path : t('editor.none')),
                ),
                h('input', {
                  key: 'input',
                  ref: input,
                  type: 'text',
                  value: draft,
                  placeholder: t('editor.placeholder'),
                  spellCheck: false,
                  'aria-label': t('editor.placeholder'),
                  onChange: (event) => setDraft(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void saveEditor(false)
                    }
                  },
                  style: EDITOR_INPUT_STYLE,
                }),
                h(
                  'div',
                  { key: 'hint', style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '10px', lineHeight: '1.5' } },
                  t('editor.hint'),
                ),
                editorMessage === null
                  ? null
                  : h(
                      'div',
                      {
                        key: 'msg',
                        style: {
                          color:
                            editorMessage.kind === 'error'
                              ? 'var(--dsw-alias-state-error-primary)'
                              : 'var(--dsw-alias-state-success-primary)',
                          overflowWrap: 'anywhere',
                        },
                      },
                      editorMessage.text,
                    ),
                h('div', { key: 'actions', style: { display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'flex-end' } }, [
                  h(
                    'button',
                    { key: 'clear', type: 'button', disabled: saving, onClick: () => void clearEditor(), style: EDITOR_BUTTON_STYLE },
                    t('editor.clear'),
                  ),
                  h(
                    'button',
                    { key: 'save', type: 'button', disabled: saving, onClick: () => void saveEditor(false), style: EDITOR_BUTTON_STYLE },
                    t('editor.save'),
                  ),
                  h(
                    'button',
                    {
                      key: 'save-open',
                      type: 'button',
                      disabled: saving,
                      onClick: () => void saveEditor(true),
                      style: saving ? Object.assign({}, EDITOR_PRIMARY_STYLE, { opacity: '0.7' }) : EDITOR_PRIMARY_STYLE,
                    },
                    t('editor.saveOpen'),
                  ),
                ]),
              ],
            )

      return h('span', { ref: root, style: { display: 'inline-flex', position: 'relative' } }, [
        h('span', { key: 'group', style: BADGE_GROUP_STYLE }, [
          h(
            'button',
            {
              key: 'main',
              type: 'button',
              'data-open-project': 'true',
              title: tip,
              'aria-label': tip,
              disabled: opening,
              onClick: () => {
                if (target === null) openEditor()
                else void open()
              },
              onContextMenu: (event) => {
                event.preventDefault()
                openEditor()
              },
              style: Object.assign({}, BADGE_BUTTON_STYLE, {
                color: tone,
                cursor: opening ? 'progress' : 'pointer',
                opacity: opening ? '0.75' : '1',
              }),
            },
            [h(FolderIcon, { key: 'icon', tint: iconTint }), h('span', { key: 'label' }, label)],
          ),
          h(
            'button',
            {
              key: 'caret',
              type: 'button',
              title: t('tip.edit'),
              'aria-label': t('tip.edit'),
              'aria-haspopup': 'dialog',
              'aria-expanded': editorOpen === true ? 'true' : 'false',
              'data-open-project-edit': 'true',
              onClick: () => {
                if (editorOpen) setEditorOpen(false)
                else openEditor()
              },
              style: CARET_STYLE,
            },
            '▾',
          ),
        ]),
        editor,
      ])
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, COPY), 'dsh-open-project: dictionaries')

      const slots = ctx.get('slots')
      for (const seat of SEATS) {
        ctx.effect(
          () =>
            slots.inject(seat.name, () => {
              const dispose = slots.register(
                {
                  name: seat.name,
                  id: ENTRY_ID,
                  order: seat.order,
                  locale: NS,
                  inject: (sessionId) => ({ sessionId }),
                },
                OpenProjectBadge,
              )
              return () => dispose()
            }),
          'dsh-open-project: badge ' + seat.name,
        )
      }
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
