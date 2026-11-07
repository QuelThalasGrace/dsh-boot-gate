/**
 * dsh-boot-gate — browser half (Cordis client plugin).
 *
 * 目标：壁纸（wallpaper-engine）在开机动画（startup-screen）结束之前不播，也不露出来。
 *
 * 设计原则（v0.3.0）：
 *   1. 分层：probe（判断开机动画状态）/ target（找到壁纸）/ controller（编排）
 *   2. 契约优先：先看全局量与显式 API，再退到 DOM 选择器
 *   3. fail-open：任何一层探测失败都直接放行，绝不让壁纸黑着
 *   4. 迟到者不干预：放行后新建的壁纸视频不再接管
 *   5. 可配置：隐藏开关、宽限期、最长等待，都走 window.__DSH_BOOT_GATE_CONFIG__
 *
 * 注意：ModuleLoader 的 bundle 是普通脚本（不是 ESM），所以三层只能放同一个文件里，
 * 用函数边界区分，不能拆成 import。
 */
window.__ModuleLoader__.load({
  id: 'dsh-boot-gate',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var inject = []

    var DEFAULTS = {
      hide: true,        // 开机动画期间把 .we-layer 藏起来（关掉就只暂停、不隐藏）
      graceMs: 2000,     // 等开机动画节点出现的宽限期
      maxWaitMs: 180000, // 兜底：无论发生什么，最多等这么久
      pollMs: 120,
    }

    function readConfig() {
      var src = (typeof window !== 'undefined' && window.__DSH_BOOT_GATE_CONFIG__) || {}
      var out = {}
      for (var k in DEFAULTS) out[k] = typeof src[k] === 'undefined' ? DEFAULTS[k] : src[k]
      return out
    }

    /* ── 样式：只注入一次 ─────────────────────────────────────────────── */
    function injectStyle() {
      try {
        if (document.querySelector('style[data-dsh-boot-gate]')) return
        var s = document.createElement('style')
        s.setAttribute('data-dsh-boot-gate', '')
        s.textContent = 'html.dsh-boot-gating .we-layer{visibility:hidden!important}'
        ;(document.head || document.documentElement).appendChild(s)
      } catch (e) { /* 失败不挡 */ }
    }

    /* ── probe：开机动画现在处于什么状态 ──────────────────────────────── */
    function createProbe(cfg) {
      var startedAt = Date.now()
      var seenRoot = false

      function rootEl() {
        var el = null
        try { el = document.getElementById('dsh-startup-root') } catch (e) {}
        if (el) seenRoot = true
        return el
      }

      return {
        seen: function () { return seenRoot },
        // 'active' | 'finished' | 'unknown'
        state: function () {
          try {
            if (window.__DSH_STARTUP_SKIP__ === true) return 'finished'
            if (window.__DSH_STARTUP_FINISHED__ === true) return 'finished'
            var el = rootEl()
            if (el) {
              if (el.classList && el.classList.contains('dsu-gone')) return 'finished'
              return 'active'
            }
            // 还没有节点：给宽限期，等它出现
            if (!seenRoot && Date.now() - startedAt < cfg.graceMs) return 'unknown'
            return 'finished' // 没有开机动画（或宽限期已过）：放行
          } catch (e) {
            return 'finished'
          }
        },
      }
    }

    /* ── target：壁纸在哪、怎么暂停/恢复 ─────────────────────────────── */
    function dedupe(list) {
      var out = []
      for (var i = 0; i < list.length; i++) if (out.indexOf(list[i]) === -1) out.push(list[i])
      return out
    }

    function collectVideos() {
      var found = []
      try {
        var layers = document.querySelectorAll('.we-layer')
        for (var i = 0; i < layers.length; i++) {
          var vs = layers[i].querySelectorAll('video')
          for (var j = 0; j < vs.length; j++) found.push(vs[j])
        }
      } catch (e) {}
      if (!found.length) {
        // 兜底：页面上所有不被开机动画包含的 video
        try {
          var all = document.querySelectorAll('video')
          for (var k = 0; k < all.length; k++) {
            var v = all[k]
            if (v.closest && v.closest('#dsh-startup-root')) continue
            found.push(v)
          }
        } catch (e) {}
      }
      return dedupe(found)
    }

    function collectTargets() {
      var targets = []
      // 契约优先：壁纸插件若暴露播放 API，直接用
      try {
        var api = window.__DSH_WALLPAPER__ || window.__DSH_WE__
        if (api && typeof api.pause === 'function') targets.push({ api: api })
      } catch (e) {}
      var vs = collectVideos()
      for (var i = 0; i < vs.length; i++) targets.push({ el: vs[i] })
      return targets
    }

    function pauseTarget(t) {
      try {
        if (t.api) { t.api.pause(); return }
        var v = t.el
        if (!v) return
        if (!v.paused) v.pause()
        if (v.currentTime > 0.02) v.currentTime = 0
      } catch (e) {}
    }

    function playTarget(t) {
      try {
        if (t.api) {
          if (typeof t.api.reset === 'function') t.api.reset()
          if (typeof t.api.play === 'function') t.api.play()
          return
        }
        var v = t.el
        if (!v) return
        try { v.currentTime = 0 } catch (e) {}
        var p = v.play()
        if (p && p.catch) p.catch(function () {})
      } catch (e) {}
    }

    /* ── controller ──────────────────────────────────────────────────── */
    function createController(cfg) {
      var probe = createProbe(cfg)
      var released = false
      var timer = null
      var observer = null
      var state = 'waiting' // waiting | gating | released
      var reason = null

      function setHidden(on) {
        if (!cfg.hide) return
        try { document.documentElement.classList.toggle('dsh-boot-gating', !!on) } catch (e) {}
      }

      function pauseAll() {
        var ts = collectTargets()
        for (var i = 0; i < ts.length; i++) pauseTarget(ts[i])
      }

      function release(reason) {
        if (released) return
        released = true
        state = 'released'
        if (timer) { clearInterval(timer); timer = null }
        if (observer) { try { observer.disconnect() } catch (e) {} observer = null }
        setHidden(false)
        var ts = collectTargets()
        for (var i = 0; i < ts.length; i++) playTarget(ts[i])
        self.reason = reason || 'released'
      }

      function tick() {
        if (released) return
        var s = probe.state()
        if (s === 'active') {
          state = 'gating'
          setHidden(true)
          pauseAll()
          return
        }
        if (s === 'unknown') return
        release('boot-finished')
      }

      // 开机动画期间新插进来的壁纸视频也要接管
      try {
        observer = new MutationObserver(function () {
          if (released) return
          if (probe.state() === 'active') { setHidden(true); pauseAll() }
        })
        observer.observe(document.documentElement, { childList: true, subtree: true })
      } catch (e) { observer = null }

      // 捕获阶段拦 play：autoplay 抢先播也压得住
      try {
        document.addEventListener('play', function (ev) {
          if (released) return
          var v = ev.target
          if (!v || v.tagName !== 'VIDEO') return
          if (v.closest && v.closest('#dsh-startup-root')) return
          if (probe.state() === 'active') pauseTarget({ el: v })
        }, true)
      } catch (e) {}

      timer = setInterval(tick, cfg.pollMs)
      setTimeout(function () { release('timeout') }, cfg.maxWaitMs)
      tick()

      var self = {
        release: function () { release('manual') },
        get state() { return state },
        get released() { return released },
        get reason() { return reason },
      }
      return self
    }

    function apply() {
      try {
        if (window.__DSH_BOOT_GATE_LOADED__) return
        window.__DSH_BOOT_GATE_LOADED__ = true
        var cfg = readConfig()
        injectStyle()
        var ctl = createController(cfg)
        window.__DSH_BOOT_GATE__ = {
          version: '0.3.0',
          get state() { return ctl.state },
          get released() { return ctl.released },
          get reason() { return ctl.reason },
          release: function () { ctl.release() },
          targets: function () { return collectTargets().length },
        }
      } catch (e) {
        // 失败即降级：不挡启动，也不干预壁纸
        try {
          window.__DSH_BOOT_GATE__ = { version: '0.3.0', state: 'failed', released: true, reason: 'error' }
        } catch (e2) {}
      }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
