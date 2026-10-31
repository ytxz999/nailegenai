/* ============================================================================
   prop-bar.js —— 表现层：道具条（三个按钮 + 剩余次数）
   它是纯展示 + 转发：点击后把 kind 交给外部注册的回调，
   自己**不判断**能不能用、也不改次数（次数在 PropManager，能不能用在 Game.can）。
   为什么不在按钮里写 disabled 逻辑就完事：
     如果按钮自己决定"没次数就禁用"，那"状态不对（终局/暂停）"就漏了，
     会出现结算弹窗背后的道具条还能点的情况。
   ========================================================================= */
(function (SM) {
  'use strict';

  // 图标与显示名都来自登记表（P07 走查 S-1）；这里不再自带一份 GLYPH 字典
  function glyphOf(kind) { return SM.PropTable ? SM.PropTable.glyph(kind) : '?'; }
  function labelOf(kind) { return SM.PropTable ? SM.PropTable.label(kind) : kind; }

  function PropBar(rootEl) {
    if (!rootEl) throw new Error('PropBar: 缺少根节点');
    this._root = rootEl;
    this._buttons = {};
    this._handler = null;
    this._build();
  }

  PropBar.prototype._build = function () {
    var self = this;
    this._root.innerHTML = '';
    SM.PropManager.KINDS.forEach(function (kind) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'prop prop--' + kind;
      btn.dataset.kind = kind;
      btn.title = labelOf(kind);

      var glyph = document.createElement('span');
      glyph.className = 'prop__glyph';
      glyph.textContent = glyphOf(kind);

      var label = document.createElement('span');
      label.className = 'prop__label';
      label.textContent = labelOf(kind);

      var count = document.createElement('span');
      count.className = 'prop__count';
      count.textContent = '0';

      btn.appendChild(glyph);
      btn.appendChild(label);
      btn.appendChild(count);
      btn.addEventListener('click', function () { self._emit(kind); });

      self._root.appendChild(btn);
      self._buttons[kind] = btn;
    });
  };

  PropBar.prototype._emit = function (kind) {
    if (this._handler) this._handler(kind);
  };

  /** 外部注册"玩家按了哪个道具"；传 null 可解绑 */
  PropBar.prototype.bindUse = function (fn) {
    this._handler = (typeof fn === 'function') ? fn : null;
    return this;
  };

  /**
   * @param {Object} snapshot Game.snapshot()，需要 props / canUndo / state / holdingSize
   *   撤销的可用性还要看"栈里有没有东西"：次数还有但栈空（比如刚开局）时，
   *   按钮亮着点下去只弹一句"没有可撤销的操作"，不如直接置灰。
   *   R-13 之后"移出"的落点是暂存区，暂存区满了同样点不动 —— 否则点下去必然被拒。
   *
   *   这两种"额外条件"挂在登记表的 `enable(snapshot)` 上（P07 走查 S-1），
   *   本方法只负责"次数 > 0 且处于进行中"，不再认识具体是哪种道具。
   */
  PropBar.prototype.render = function (snapshot) {
    var props = snapshot.props || {};
    var playing = snapshot.state === 'Playing';
    var holdingFull = (snapshot.holdingSize || 0) >= SM.Holding.CAPACITY;
    var ctx = { snapshot: snapshot, holdingFull: holdingFull };
    for (var i = 0; i < SM.PropManager.KINDS.length; i++) {
      var kind = SM.PropManager.KINDS[i];
      var btn = this._buttons[kind];
      var n = props[kind] || 0;
      var spec = SM.PropTable ? SM.PropTable.get(kind) : null;
      var usable = playing && n > 0 && (!spec || !spec.enable || spec.enable(ctx));
      btn.disabled = !usable;
      btn.classList.toggle('is-empty', n <= 0);
      btn.querySelector('.prop__count').textContent = '×' + n;
    }
    this._root.classList.toggle('propbar--locked', !playing);
  };

  SM.PropBar = PropBar;
})(window.SM = window.SM || {});
