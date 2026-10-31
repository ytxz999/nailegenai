/* ============================================================================
   prop-manager.js —— 引擎层：道具次数（薄壳）
   设计 D-09：它只做"还有几次、能不能用、扣一次、还一次"。
   撤销/移出/洗牌**各自的效果**一点都不能写在这里 —— 那属于 Board / Tray / Command。
   这样换一种道具只需要加一个命令类，次数管理一行都不用改。
   ========================================================================= */
(function (SM) {
  'use strict';

  /**
   * 三种道具的 kind 清单（P07 走查 S-1）：从 `SM.PropTable` 取，不在这里重复写一遍。
   * 顺序即界面排列顺序；键名与 levels.js 的 props 一致。
   * 缺 PropTable 时（脚本顺序被改坏）退化成运行时探测，让错误停在加载期而不是首次用道具。
   */
  var KINDS = (SM.PropTable && SM.PropTable.KINDS) || ['undo', 'remove', 'shuffle'];

  /**
   * @param {Object} counts 当前剩余次数 { undo, remove, shuffle } —— 来自关卡配置，不在代码里写死
   * @param {Object} [initial] 初始次数。读档时必须单独给：玩家已经用掉两次撤销，
   *   若把"当前剩余"当成初始值，撤销道具就再也还不回去了（refill 的上限会错）。
   */
  function PropManager(counts, initial) {
    counts = counts || {};
    var cap = initial || counts;
    this._initial = {};
    this._counts = {};
    for (var i = 0; i < KINDS.length; i++) {
      var k = KINDS[i];
      var n = counts[k] === undefined ? 0 : counts[k];
      var m = cap[k] === undefined ? n : cap[k];
      if (!Number.isInteger(n) || n < 0) throw new Error('PropManager: ' + k + ' 的次数必须是非负整数');
      if (!Number.isInteger(m) || m < n) throw new Error('PropManager: ' + k + ' 的初始次数不能小于当前次数');
      this._counts[k] = n;
      this._initial[k] = m;
    }
  }

  PropManager.KINDS = KINDS;
  // 显示名统一由登记表提供（S-1）；保留这个静态字段是为了兼容既有调用点（PropBar 等）
  PropManager.LABELS = (SM.PropTable && SM.PropTable.KINDS) ? (function () {
    var out = {};
    for (var i = 0; i < KINDS.length; i++) out[KINDS[i]] = SM.PropTable.label(KINDS[i]);
    return out;
  })() : { undo: '撤销', remove: '移出', shuffle: '洗牌' };

  PropManager.prototype.count = function (kind) {
    this._checkKind(kind);
    return this._counts[kind];
  };

  PropManager.prototype.counts = function () {
    var out = {};
    for (var i = 0; i < KINDS.length; i++) out[KINDS[i]] = this._counts[KINDS[i]];
    return out;
  };

  PropManager.prototype.initialCounts = function () {
    var out = {};
    for (var i = 0; i < KINDS.length; i++) out[KINDS[i]] = this._initial[KINDS[i]];
    return out;
  };

  /**
   * 能不能用。
   * "为什么不能用"要能说得清：体力类游戏里玩家最烦的就是点了没反应，
   * 所以这里返回 reason，由界面决定是置灰还是提示。
   */
  PropManager.prototype.canUse = function (kind) {
    this._checkKind(kind);
    if (this._counts[kind] <= 0) return { ok: false, reason: 'no-count' };
    return { ok: true };
  };

  /** 扣一次；扣不动返回 false（调用方必须**先** canUse 再 consume） */
  PropManager.prototype.consume = function (kind) {
    this._checkKind(kind);
    if (this._counts[kind] <= 0) return false;
    this._counts[kind] -= 1;
    return true;
  };

  /** 撤销道具时归还一次（不超过初始值：连撤十次也变不出第 4 次移出） */
  PropManager.prototype.refill = function (kind) {
    this._checkKind(kind);
    if (this._counts[kind] >= this._initial[kind]) return false;
    this._counts[kind] += 1;
    return true;
  };

  PropManager.prototype._checkKind = function (kind) {
    if (KINDS.indexOf(kind) < 0) throw new Error('PropManager: 未知道具 ' + kind);
  };

  SM.PropManager = PropManager;
})(window.SM = window.SM || {});
