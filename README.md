# dsh-boot-gate

让壁纸（`dsh-plugin-wallpaper-engine` 的视频）**等开机动画（`dsh-startup-screen`）播完再开始播**，
顺便消掉启动瞬间闪一下壁纸的问题。

无依赖、无构建步骤，约 6 KB。

## 设计（v0.3.0）

三层结构，全部在浏览器侧（`lib/client.js`）：

| 层 | 职责 | 策略（按优先级） |
|---|---|---|
| probe | 判断开机动画状态 | `__DSH_STARTUP_SKIP__` / `__DSH_STARTUP_FINISHED__` → `#dsh-startup-root` → 宽限期后视为没有 |
| target | 找到壁纸 | `window.__DSH_WALLPAPER__` 播放 API → `.we-layer video` → 全页 video（排除开机动画内的） |
| controller | 编排 | 轮询 + MutationObserver + 捕获 play 事件 + 超时兜底 |

原则：

- **fail-open**：任何一层探测失败都直接放行，绝不让壁纸黑着
- **迟到者不干预**：放行后新建的壁纸视频不再接管
- **只藏不播**：Scene（canvas）类壁纸没法归零时间，只能靠隐藏
- **宿主侧空实现**：桌面端没有 `webServer`，注入 index.html 那条路不存在，因此不维护第二份逻辑

## 配置

在页面里设置（可选，刷新生效）：

```js
window.__DSH_BOOT_GATE_CONFIG__ = {
  hide: true,        // 开机动画期间是否隐藏 .we-layer
  graceMs: 2000,     // 等开机动画节点出现的宽限期
  maxWaitMs: 180000, // 兜底最长等待
  pollMs: 120,       // 轮询间隔
}
```

调试：`window.__DSH_BOOT_GATE__` 暴露 `{ version, state, released, reason, release(), targets() }`，
`reason` 会是 `boot-finished` / `timeout` / `manual` / `error` 之一。

## 安装

### 从 GitHub（推荐）

web profile：

```sh
dsh plugin --profile web add github:QuelThalasGrace/dsh-boot-gate
```

桌面端：设置 → **插件** → **添加插件** → 填 GitHub 地址
`QuelThalasGrace/dsh-boot-gate`（或完整 `github:` 前缀）→ 安装 → **重启 DSH**。

> 仓库里已经提交了构建产物 `lib/`，也没有 `prepare` 生命周期脚本，所以安装不编译任何东西，
> 不会被 pnpm 的 `allowBuilds` 拦住。

### 本地目录

设置 → **插件** → **添加插件** → 「本地目录」→ 选中本文件夹 → 安装 → **重启 DSH**。

> 从本地目录安装后，profile 记的是指向这个目录的 `file:` 依赖：**装好别移动/删除本文件夹**。

### 本地包

```sh
npm pack                     # 生成 dsh-boot-gate-0.3.0.tgz
dsh plugin --profile web add ./dsh-boot-gate-0.3.0.tgz
```

## 测试

```sh
node test/gate.test.mjs
```

15 项，覆盖：无开机动画、有开机动画、动画期间新插入视频、被跳过、`hide=false`。
不依赖 jsdom，自带最小 DOM stub。

## 卸载

设置 → 插件 → 卸载 → 重启。

## 兼容性

- 目标 DOM 只有两个锚点：`#dsh-startup-root`（开机动画）与 `.we-layer video`（壁纸）
- 没有声明 `engines.dsh` / `peerDependencies`：node-semver 会把预发布版本从范围里静默排除，
  声明了反而可能被兼容闸门整包跳过。这里选择「失败即降级」
- 上游改了结构时表现为「不再生效」，不会报错、不会挡启动

## License

MIT © QuelThalasGrace
