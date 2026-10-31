/* ============================================================================
   effects.js —— 表现层：一次性视觉反馈（飘字、回弹、脉冲）
   铁律（迭代 6 约束）：
     · **只影响表现，绝不改变状态**——这里没有一行代码会碰 Board / Tray / Game；
     · 元素都在动画结束后自己从 DOM 上摘掉，不留垃圾节点（Leak 检查见 _sweep）；
     · 降低动效（settings.reduceMotion）时直接不产生——由 Renderer 传 reduceMotion 进来。
   为什么要单独一个对象：这些元素的生命周期比"一次点击"略长（飘字 700ms、回弹 200ms），
   放在 Renderer 里会和"渲染当前局面"这件事混在一起——局面渲染是幂等的，飘字不是。
   ========================================================================= */
(function (SM) {
  'use strict';

  var FLOAT_MS = 780;
  var POP_MS = 220;

  function Effects(opts) {
    opts = opts || {};
    this._host = opts.hostEl || document.body;   // 飘字挂在这一层（position: relative）
    this._layer = null;
    this.reduceMotion = !!opts.reduceMotion;
    this._live = [];                             // 还在飞的元素，便于一次性清空
  }

  /* ---------------------------------------------------------------- 内部 */

  Effects.prototype._ensureLayer = function () {
    if (this._layer && this._layer.parentNode) return this._layer;
    var el = document.createElement('div');
    el.className = 'fx-layer';
    this._host.appendChild(el);
    this._layer = el;
    return el;
  };

  /** 把"舞台坐标"换算成"飘字层坐标"：两层都可能是缩放过的，所以用倍数换算 */
  Effects.prototype._toLayer = function (clientX, clientY) {
    var hostRect = this._host.getBoundingClientRect();
    return { x: clientX - hostRect.left, y: clientY - hostRect.top };
  };

  /** 登记一个会自己消失的元素；到点就摘，避免长局堆几百个节点 */
  Effects.prototype._track = function (el, ms) {
    var self = this;
    this._live.push(el);
    window.setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
      var i = self._live.indexOf(el);
      if (i >= 0) self._live.splice(i, 1);
    }, ms + 60);
  };

  /* ---------------------------------------------------------------- 对外 */

  /** 牌落位时轻弹一下：给"这张牌真的进槽了"一个手感 */
  Effects.prototype.pop = function (node) {
    if (this.reduceMotion || !node) return;
    node.classList.remove('fx-pop');
    void node.offsetWidth;                 // 强制重排，否则同一个类名不会重启动画
    node.classList.add('fx-pop');
    window.setTimeout(function () {
      if (node.classList) node.classList.remove('fx-pop');
    }, POP_MS + 60);
  };

  /**
   * 在某个元素的中心上方飘一行字（"凑齐三张"这类即时反馈）。
   * 参数用元素而不是坐标，是为了不依赖调用方知道布局细节。
   */
  Effects.prototype.floatOver = function (anchorEl, text) {
    if (this.reduceMotion || !anchorEl) return;
    var rect = anchorEl.getBoundingClientRect();
    var at = this._toLayer(rect.left + rect.width / 2, rect.top);
    this._float(text, at.x, at.y);
  };

  /** 同上，但直接给屏幕坐标（牌被删掉了、只剩 rect 时用） */
  Effects.prototype.floatAt = function (clientX, clientY, text) {
    if (this.reduceMotion) return;
    var at = this._toLayer(clientX, clientY);
    this._float(text, at.x, at.y);
  };

  Effects.prototype._float = function (text, x, y) {
    var layer = this._ensureLayer();
    var el = document.createElement('span');
    el.className = 'fx-float';
    el.textContent = text;
    el.style.left = Math.round(x) + 'px';
    el.style.top = Math.round(y) + 'px';
    layer.appendChild(el);
    this._track(el, FLOAT_MS);
  };

  /** HUD 某格跳一下（剩余张数变化时给个提示） */
  Effects.prototype.pulse = function (el) {
    if (this.reduceMotion || !el) return;
    el.classList.remove('fx-pulse');
    void el.offsetWidth;
    el.classList.add('fx-pulse');
    window.setTimeout(function () {
      if (el.classList) el.classList.remove('fx-pulse');
    }, 420);
  };

  /** 换关 / 重开时清场：飘字飞到一半就换局，不清会残留到下一局 */
  Effects.prototype.clearAll = function () {
    this._live.slice().forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    this._live.length = 0;
  };

  Effects.prototype.setReduceMotion = function (on) {
    this.reduceMotion = !!on;
    if (this.reduceMotion) this.clearAll();
  };

  SM.Effects = Effects;
}(window.SM = window.SM || {}));
