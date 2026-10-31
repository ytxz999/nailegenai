/* ============================================================================
   input.js —— 表现层：点击输入（把"点到的 DOM 节点"翻译成"模型里的牌 id"）
   这一层的全部职责：找到被点的是哪张牌 → 调 game.clickTile(id) → 把结果交给 Renderer 放动画。
   它**不判断**能不能点：浏览器把点击给了上层那张牌，只说明"视觉上它在上面"，
   真正的判定仍由 Board.canPick 在 Game 里复核（设计 §7.4）。
   为什么不用每张牌各绑一个监听：牌会被删了重建，绑在每张牌上的监听要跟着搬；
   绑在舞台容器上做事件委托，牌怎么增删都只绑一次。
   ========================================================================= */
(function (SM) {
  'use strict';

  function Input(opts) {
    opts = opts || {};
    if (!opts.stageEl) throw new Error('Input: 缺少 stage 元素');
    if (!opts.game) throw new Error('Input: 缺少 game');
    if (!opts.renderer) throw new Error('Input: 缺少 renderer');

    this._stage = opts.stageEl;
    this._game = opts.game;
    this._renderer = opts.renderer;
    // 暂存区也是"可以点牌"的地方（R-13：移出的牌能点回槽位），一并做事件委托
    this._holding = opts.holdingEl || null;
    this._bound = false;
  }

  Input.prototype.bind = function () {
    if (this._bound) return this;
    var self = this;
    var roots = [this._stage];
    if (this._holding) roots.push(this._holding);

    roots.forEach(function (root) {
      root.addEventListener('click', function (ev) {
        var node = ev.target && ev.target.closest ? ev.target.closest('.tile') : null;
        if (!node || !root.contains(node)) return;
        self.clickTile(node.dataset.id);
      });
    });
    this._bound = true;
    return this;
  };

  /**
   * 一次点击的完整处理。也供控制台直接调用（验收要求"手工调用判定函数"）：
   *   SM.app.input.clickTile('t003')
   */
  Input.prototype.clickTile = function (tileId) {
    if (!tileId) return { ok: false, kind: 'noop' };

    // 起点矩形要在模型变动之前取：一旦入槽，牌堆里的节点就会被移除，取不到原位了
    var sel = '.tile[data-id="' + tileId + '"]';
    var node = this._stage.querySelector(sel) ||
               (this._holding ? this._holding.querySelector(sel) : null);
    var fromRect = node ? node.getBoundingClientRect() : null;

    var result = this._game.clickTile(tileId);

    if (result.kind === 'enter' || result.kind === 'clear') {
      this._renderer.playEnter(fromRect, result, this._game);
    } else if (result.kind === 'reject') {
      this._renderer.shake(tileId);
    }
    return result;
  };

  SM.Input = Input;
})(window.SM = window.SM || {});
