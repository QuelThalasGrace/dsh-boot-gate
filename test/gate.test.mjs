/**
 * Minimal DOM-stub tests for dsh-boot-gate (no jsdom dependency).
 * Run: node test/gate.test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const code = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8')

class ClassList {
  constructor() { this.s = new Set() }
  add(c) { this.s.add(c) }
  remove(c) { this.s.delete(c) }
  contains(c) { return this.s.has(c) }
  toggle(c, on) { on ? this.add(c) : this.remove(c) }
}

function makeVideo() {
  return {
    tagName: 'VIDEO', paused: true, currentTime: 3.5,
    play() { this.paused = false; return Promise.resolve() },
    pause() { this.paused = true },
    closest() { return null },
  }
}

function makeEnv() {
  const state = { root: null, layers: [], videos: [], listeners: {} }
  const html = { classList: new ClassList() }
  const doc = {
    documentElement: html,
    head: { appendChild() {} },
    readyState: 'complete',
    createElement: () => ({ setAttribute() {}, textContent: '', classList: new ClassList() }),
    getElementById: (id) => (id === 'dsh-startup-root' ? state.root : null),
    querySelector: () => null,
    querySelectorAll: (sel) => {
      if (sel === '.we-layer') return state.layers
      if (sel === 'video') return state.videos
      return []
    },
    addEventListener: (t, f) => { (state.listeners[t] ||= []).push(f) },
  }
  return { state, doc, html }
}

function load(env) {
  const win = {}
  globalThis.window = win
  globalThis.document = env.doc
  globalThis.MutationObserver = class { observe() {} disconnect() {} }
  let reg = null
  win.__ModuleLoader__ = { load: (m) => { reg = m } }
  // eslint-disable-next-line no-eval
  ;(0, eval)(code)
  return reg
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log('  ok  ', name) }
  else { fail++; console.log('  FAIL', name) }
}

async function scenarioNoBoot() {
  console.log('scenario: 没有开机动画')
  const env = makeEnv()
  const v = makeVideo()
  env.state.layers = [{ querySelectorAll: () => [v] }]
  globalThis.window = undefined
  const reg = load(env)
  globalThis.window.__DSH_BOOT_GATE_CONFIG__ = { graceMs: 30, pollMs: 10 }
  reg.factory(() => ({})).apply()
  await sleep(120)
  check('放行', globalThis.window.__DSH_BOOT_GATE__.released === true)
  check('视频在播', v.paused === false)
  check('没有隐藏类', env.html.classList.contains('dsh-boot-gating') === false)
}

async function scenarioGate() {
  console.log('scenario: 有开机动画')
  const env = makeEnv()
  const v = makeVideo()
  env.state.layers = [{ querySelectorAll: () => [v] }]
  env.state.root = { classList: new ClassList() }
  globalThis.window = undefined
  const reg = load(env)
  globalThis.window.__DSH_BOOT_GATE_CONFIG__ = { graceMs: 30, pollMs: 10 }
  reg.factory(() => ({})).apply()
  await sleep(80)
  const g = globalThis.window.__DSH_BOOT_GATE__
  check('处于 gating', g.state === 'gating')
  check('已隐藏', env.html.classList.contains('dsh-boot-gating') === true)
  check('视频被暂停', v.paused === true)
  check('时间被归零', v.currentTime <= 0.05)

  // 动画期间新插入的视频
  const v2 = makeVideo()
  env.state.layers.push({ querySelectorAll: () => [v2] })
  await sleep(60)
  check('迟到视频也被暂停', v2.paused === true)

  // 开机动画结束
  env.state.root.classList.add('dsu-gone')
  await sleep(80)
  check('已放行', g.released === true)
  check('隐藏类移除', env.html.classList.contains('dsh-boot-gating') === false)
  check('视频恢复播放', v.paused === false && v2.paused === false)
}

async function scenarioSkip() {
  console.log('scenario: 开机动画被跳过')
  const env = makeEnv()
  const v = makeVideo()
  env.state.layers = [{ querySelectorAll: () => [v] }]
  env.state.root = { classList: new ClassList() }
  globalThis.window = undefined
  const reg = load(env)
  globalThis.window.__DSH_STARTUP_SKIP__ = true
  globalThis.window.__DSH_BOOT_GATE_CONFIG__ = { graceMs: 30, pollMs: 10 }
  reg.factory(() => ({})).apply()
  await sleep(60)
  check('立即放行', globalThis.window.__DSH_BOOT_GATE__.released === true)
  check('视频在播', v.paused === false)
}

async function scenarioConfigNoHide() {
  console.log('scenario: hide=false')
  const env = makeEnv()
  const v = makeVideo()
  env.state.layers = [{ querySelectorAll: () => [v] }]
  env.state.root = { classList: new ClassList() }
  globalThis.window = undefined
  const reg = load(env)
  globalThis.window.__DSH_BOOT_GATE_CONFIG__ = { hide: false, graceMs: 30, pollMs: 10 }
  reg.factory(() => ({})).apply()
  await sleep(60)
  check('不隐藏', env.html.classList.contains('dsh-boot-gating') === false)
  check('仍然暂停', v.paused === true)
}

await scenarioNoBoot()
await scenarioGate()
await scenarioSkip()
await scenarioConfigNoHide()

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
