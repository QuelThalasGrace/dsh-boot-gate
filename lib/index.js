/**
 * dsh-boot-gate — host half.
 *
 * 刻意什么都不做：门控全部在浏览器侧（lib/client.js）。
 *
 * 历史原因说明：桌面端的前端是 file:// + IPC 下发的，宿主侧拿不到 index.html，
 * webServer.tapIndex 在桌面端根本不生效；同一套逻辑维护两份只会制造分叉。
 * 这里保持空实现，保证插件行永远能加载、绝不挡启动。
 */

export const name = 'dsh-boot-gate'

export function apply() {
  /* no-op by design */
}
