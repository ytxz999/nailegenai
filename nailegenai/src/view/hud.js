/* ============================================================================
   hud.js —— 表现层：顶部状态栏
   只做一件事：把 Game.snapshot() 的数字写进 DOM。它不计算剩余、不算步数，
   也不猜"现在该不该显示暂停按钮"——那些都是模型的事实，视图只负责呈现。

   为什么把 HUD 从 Renderer 里拆出来：
     渲染牌堆要算缩放、要复用 45 个节点、要在动画期间上锁；
     刷新 HUD 只是写几次 textContent。两者的变化频率（60fps vs 4fps）和
     失败模式都不一样，混在一个类里，改 HUD 的排版就会碰到牌堆的代码。
   ========================================================================= */
(function (SM) {
  'use strict';

  var STATE_LABEL = {
    Idle: '未开始',
    Ready: '准备中',
    Playing: '进行中',
    Paused: '已暂停',
    Won: '通关',
    Lost: '失败'
  };

  function HUD(opts) {
    opts = opts || {};
    this._els = {
      level: opts.level || null,
      remaining: opts.remaining || null,
      moves: opts.moves || null,
      time: opts.time || null,
      state: opts.state || null
    };
    this._pauseBtn = opts.pauseBtn || null;
    this._lastState = null;
  }

  /** @param {Object} snap Game.snapshot() 的结果 */
  HUD.prototype.update = function (snap) {
    var e = this._els;
    if (e.level) e.level.textContent = snap.levelName;
    if (e.remaining) e.remaining.textContent = String(snap.remaining);
    if (e.moves) e.moves.textContent = String(snap.moves);
    if (e.time) e.time.textContent = SM.Timer.format(snap.elapsedMs);
    if (e.state) {
      e.state.textContent = STATE_LABEL[snap.state] || snap.state;
      e.state.dataset.state = snap.state;
    }
    // 暂停按钮只在"进行中"可用：这是显示逻辑，不涉及规则，所以放在视图里
    if (this._pauseBtn && this._lastState !== snap.state) {
      this._pauseBtn.disabled = snap.state !== 'Playing';
      this._pauseBtn.textContent = snap.state === 'Paused' ? '已暂停' : '暂停';
    }
    this._lastState = snap.state;
  };

  /** 计时每秒都在动，但布局不变：单独提供一个轻量入口，避免整块 HUD 重排 */
  HUD.prototype.setTime = function (ms) {
    if (this._els.time) this._els.time.textContent = SM.Timer.format(ms);
  };

  HUD.prototype.bindPause = function (handler) {
    if (!this._pauseBtn) return;
    var self = this;
    this._pauseBtn.addEventListener('click', function () {
      if (self._pauseBtn.disabled) return;
      handler();
    });
  };

  HUD.STATE_LABEL = STATE_LABEL;
  SM.HUD = HUD;
})(window.SM = window.SM || {});
