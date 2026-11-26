# dsh-open-project

给 DSH（DeepSeek Harness）对话输入框加一个【打开项目】徽标。AI 完成任务、移动了产物之后，
把「这个对话要打开什么」记下来；用户点一下徽标，就用系统默认程序打开文件，或在文件管理器里
打开文件夹。

解决的场景：开发时要先关掉应用/编辑器，避免占用文件或覆盖 AI 的修改；AI 干完活后应用可能
已经重新编译、换了输出目录，用户还得切窗口、翻目录找 exe。现在打开动作绑定在当前对话上，
路径由 AI 或用户维护。

源码与问题反馈：<https://github.com/ChongYuGit/dsh-open-project>

## 功能

- 输入框左侧一个紧凑徽标，按对话（session）隔离，互不影响。
- AI 通过工具 `open_project_target` 设置 / 读取 / 清除 / 打开目标；项目里约定之后，
  AI 移动产物可以自己更新路径，不需要用户每次提醒。
- 徽标右侧的 `▾` 打开路径编辑浮层：用户可以直接输入或粘贴绝对路径，【保存】
  【保存并打开】【清除】。还没设置目标时，点击徽标主体也会打开这个浮层；右键徽标同样。
- 页面可见时每 5 秒同步一次目标；页面重新可见或窗口获得焦点时也会立即刷新。
- 目标不存在时徽标变琥珀色，悬停提示会说明；打开失败时提示里带启动器的原因。
- 打开动作在宿主进程完成（浏览器不能直接拉起本地程序）：
  - Windows：`powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command
    "Invoke-Item -LiteralPath '<路径>'"`，等同双击，走文件关联；文件用默认程序，
    文件夹用资源管理器。
  - macOS：`open <路径>`。
  - Linux：`xdg-open <路径>`。

## 安装

### 前置条件

- DSH NEXT（桌面版），或带 `webServer` 与对话输入框插槽的 DSH Web。
- Node.js >= 22（用 DSH 自带的运行时即可）。
- 管理插件需要 `plugin_manager` 工具（标准 / Creator 模式提供），或在 GUI 的插件页操作。

### 从 npm 安装

插件发布到 npm 之后：

    plugin_manager(action="install_bundle", target="dsh-open-project")

按提示批准。安装完成后**完整退出并重新打开 DSH**——宿主插件在启动时加载，刷新页面不够。
输入框左侧出现【打开项目】徽标即安装成功。

如果公开目录已经收录，也可以在 GUI 的插件页搜索安装。收录（`dsh-plugin-catalog` 的
`plugins.json`）是单独的流程：npm 上能装，不代表市场里能搜到。

### 从本地目录安装（开发）

1. 在 profile 目录（`~/.dsh/profiles/<profile>`）的 `package.json` 里加依赖，
   路径用正斜杠：

        "dsh-open-project": "link:<插件的绝对路径>"

2. 在同一个 `package.json` 的 `dsh.profile.bundles` 数组末尾加 `"dsh-open-project"`。
3. 在 profile 目录执行 `pnpm install`。PATH 里没有 node/pnpm 时，用 DSH 运行时自带的
   那一份；pnpm 11 的供应链策略会拒绝 24 小时内发布的新包，临时加
   `--config.minimumReleaseAge=0`。
4. 完整重启 DSH。

也可以先 `pnpm pack` 得到 tgz，再让 `plugin_manager install_bundle` 指向该 tgz 的
`file:` 规格，适合内部分发。

### 安装后验证

1. 重启 DSH，任意对话输入框左侧出现【打开项目】，未设目标时图标是灰色。
2. 让 AI 调用 `open_project_target(action="set", path="...")`，最多 5 秒徽标图标变成
   主题色，悬停能看到路径。
3. 点击徽标：文件用默认程序打开，文件夹在资源管理器打开；成功后短暂显示「已打开」。
4. 把目标改名或移走：徽标变琥珀色（warn），悬停提示「目标当前不存在」。
5. 点 `▾`（或未设目标时点徽标、右键徽标）输入绝对路径，【保存】后徽标最多 5 秒更新；
   【保存并打开】立刻保存并启动；【清除】清空该对话的目标。相对路径会被拒绝，
   浮层内提示「需要绝对路径」。

## 使用

| 徽标状态 | 外观 | 说明 |
| --- | --- | --- |
| 未设置 | 灰色文件夹图标 | 这个对话还没有目标；点击打开编辑浮层 |
| 已设置 | 主题色图标 | 点击打开目标 |
| 目标不存在 | 琥珀色图标 | 路径当前不存在；悬停有提示，点击会直接提示，不会启动程序 |
| 打开中 | 文案「打开中…」 | 启动命令已发出 |
| 已打开 | 文案「已打开」 | 短暂反馈，随后恢复 |
| 打开失败 | 红色图标、文案「打开失败」 | 悬停查看具体原因 |

徽标标签通常都是「打开项目」；上面的临时文案只持续几秒。

编辑浮层里按 Enter 保存，Esc 或点击浮层外关闭；保存的路径当前不存在时浮层会保持打开，
并提示先确认产物已经生成。

## AI 工具：open_project_target

参数：

- `action`：`set` | `get` | `clear` | `open`（必填，默认 set）
- `path`：`action=set` 时必填，文件或文件夹的绝对路径

示例：

    open_project_target(action="set", path="C:\\Project\\bin\\Debug\\net8.0\\App.exe")
    open_project_target(action="set", path="C:\\Project\\bin\\Debug\\net8.0")
    open_project_target(action="get")
    open_project_target(action="open")

目标按 `exec.agent.id`（即当前对话 id）分开保存。`set` 会立刻返回路径是否存在以及是
文件还是文件夹，方便 AI 自检。路径接受绝对路径，也接受引号包裹、`~` 和 Windows 上的
`/c/...` 写法；相对路径会被拒绝。目标不存在时徽标会变琥珀色，点击会提示目标不存在
（不会启动），提醒 AI 路径已经过期。

建议在项目的 `AGENTS.md` 里写一条约定，例如：

> 构建完成、改变输出目录或移动产物后，调用 `open_project_target(action="set",
> path="<最终文件或文件夹>")` 更新当前对话的【打开项目】目标。

## HTTP 接口

宿主注册前缀路由 `/open-project`，只接受来自 DSH 界面的同源请求：

| 方法与路径 | 作用 |
| --- | --- |
| `GET /open-project/target?session=<id>` | 读取该对话的目标 |
| `POST /open-project/target?session=<id>` | 设置或清除目标，body 为 `{"path": "<绝对路径>"}` 或 `{"clear": true}` |
| `POST /open-project/open?session=<id>` | 打开该对话的目标 |

响应是 JSON（`cache-control: no-store`）。错误码：`forbidden`（非 same-origin，403）、
`missing-session`、`bad-body`、`missing-path`、`not-absolute`（400）、
`unknown-route`（404）、`internal-error`（500）。打开结果里 `code` 可能是
`no-target`、`missing`、`launch-failed` 或 `opened`。

## 数据与安全

- 状态文件：`$DSH_HOME/open-project.json`（默认 `~/.dsh/open-project.json`），明文，
  按 session 保存 `path`、`source`（`tool` 或 `user`）与 `updatedAt`。
- 不向外部发起网络请求，不收集遥测。除读取目标路径的状态（是否存在、是文件还是文件夹）并交给系统打开外，不访问其他路径。
- 路由有同源校验（`Sec-Fetch-Site` / `Origin` 与 `Host` 比对），跨站请求返回 403。
- 插件会以当前用户身份启动系统默认程序，打开用户或 AI 指定的任意路径——这就是它的功能。
  只在你信任当前对话里的 AI 时安装；不要在共享机器上把它交给不可信的 agent。
- 用户手动设置写 `source="user"`，AI 写 `source="tool"`；两边操作同一份记录，
  最后写入的生效（AI 移动产物后再 set 会覆盖用户之前的手动设置）。

## 平台支持

- Windows：宿主侧启动器已在 Windows 11 + DSH NEXT 2.0.24 上验证，文件与文件夹都能打开。
- macOS：`open <路径>`，逻辑已实现，未实测。
- Linux：`xdg-open <路径>`，需要桌面会话和 xdg-utils，未实测。
- 无 GUI 的远程 DSH：不要安装，没有可打开的目标。

## 排错

- **重启后没有徽标**：确认 profile 的 `dsh.profile.bundles` 含 `dsh-open-project`，
  并且 profile 的 `node_modules` 里能找到这个包；宿主只在启动时读 bundles，需要完整退出
  （包括托盘）再打开。
- **点击后提示 `Application not found`**：Windows 的文件关联指向了已不存在的程序
  （很常见：旧版编辑器/Godot 卸载后关联没更新）。改设文件夹，或在系统里重新关联该扩展名。
- **打开文件夹没反应**：`Invoke-Item` 走的是 shell 关联；先在资源管理器里双击验证默认
  打开方式是否正常。
- **外部浏览器访问路由得到 403**：DSH 禁止外部浏览器访问宿主接口，请从 GUI 内使用。
- **安装时报 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`**：新发布的包不足 24 小时，
  在 profile 目录执行 `pnpm install --config.minimumReleaseAge=0` 重试。
- **`node --test test/host.test.mjs` 报 spawn EPERM**：受限沙箱会拦测试运行器的子进程，
  直接运行 `node test/host.test.mjs` 即可。

## 开发与自测

    node test/host.test.mjs

测试覆盖状态读写隔离、路径归一化（引号、`~`、`/c/...`）、路由同源与错误码、启动命令
拼装。测试使用临时 `DSH_HOME`，不会污染真实状态，也不会真的启动程序。

客户端半边（`client.js`）只在 `conversation.input.left` 座位注册徽标；right/dock
座位会在对话上方多渲染一份整行按钮，所以不要同时注册。

## 卸载

    plugin_manager(action="remove_bundle", target="dsh-open-project")

然后完整重启 DSH。状态文件可留可删：`$DSH_HOME/open-project.json`。

## 发布（维护者）

    pnpm pack                    # 先检查 tarball 内容
    pnpm publish --access public

发版前修改 `version`；需要的话再补 `repository`、`homepage` 等字段。

## English

dsh-open-project adds an **Open project** badge to the DSH composer. The AI records a
per-conversation target file or folder with the `open_project_target` tool; one click
opens it with the OS default application (or the file manager for folders). A `▾`
button lets the user set, save-and-open, or clear the target manually. State lives in
`$DSH_HOME/open-project.json`; routes are same-origin only and no network calls are made.
Windows is verified; macOS and Linux launchers are implemented but untested.

## License

MIT.
