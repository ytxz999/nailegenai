/* ============================================================================
   slot-strip-view.js —— 表现层：一排固定槽格 + 槽里的牌（P07 走查 S-2）

   为什么抽出来：
     `tray-view.js` 与 `holding-view.js` 原先有 90% 是逐行重复——建格、建牌节点、
     全量同步、清场、闪一下，只有「格子数」「类名」「数据属性名」三处不同。
     两份代码各自演化，改一处忘另一处（比如槽满泛红先给谁加）是迟早的事。

   分工：
     · 基类只认"一排定长格子 + 格里的牌"这一件事，不认识 Tray 也不认识 Holding，
       只要求传进来的对象有 `toArray()` / `isFull()` / `size()`（两者都是这个形状）。
     · 子类只声明差异：格数从哪来、格子叫什么、牌节点叫什么、牌能不能点。

   两条定位约定（来自 R-09，别改回去）：
     1. 格子是**背景**：位置固定、永不增减，玩家看得出"有几格、还剩几格"。
     2. 槽里的牌是**绝对定位浮层**：位置由 `--slot-i` 算出来。
        模型一"压紧"，CSS 的 left 过渡会自己滑过去，不用手写 FLIP。
   ========================================================================= */
(function (SM) {
  'use strict';

  /**
   * @param {Object} opts
   *   rootEl        容器
   *   capacity      格子数
   *   slotClass     格子的 class（如 'slot' / 'slot slot--holding'）
   *   slotDataKey   格子的 dataset 键（如 'slot' / 'holdingSlot'）
   *   tileClass     牌节点的 class（如 'tile tile--tray'）
   *   fullClass     整排"满"时挂的 class，默认 'is-full'
   */
  function SlotStripView(opts) {
    if (!opts || !opts.rootEl) throw new Error('SlotStripView: 缺少根元素');
    this._root = opts.rootEl;
    this._capacity = opts.capacity || 0;
    this._slotClass = opts.slotClass || 'slot';
    this._slotDataKey = opts.slotDataKey || 'slot';
    this._tileClass = opts.tileClass || 'tile';
    this._fullClass = opts.fullClass || 'is-full';
    this._iconSet = null;
    this._slotEls = [];
    this._tileEls = new Map();   // tileId → DOM 节点
    this._buildSlots();
  }

  SlotStripView.prototype._buildSlots = function () {
    this._root.innerHTML = '';
    this._slotEls = [];
    for (var i = 0; i < this._capacity; i++) {
      var el = document.createElement('div');
      el.className = this._slotClass;
      el.dataset[this._slotDataKey] = String(i);
      this._root.appendChild(el);
      this._slotEls.push(el);
    }
  };

  SlotStripView.prototype.setIconSet = function (iconSet) { this._iconSet = iconSet; };

  SlotStripView.prototype.capacity = function () { return this._capacity; };

  SlotStripView.prototype.slotEl = function (index) { return this._slotEls[index] || null; };

  /** 某个槽位在屏幕上的矩形（飞行层用它当落点） */
  SlotStripView.prototype.slotRect = function (index) {
    var el = this.slotEl(index);
    return el ? el.getBoundingClientRect() : null;
  };

  SlotStripView.prototype.tileEl = function (tileId) { return this._tileEls.get(tileId) || null; };

  SlotStripView.prototype._createNode = function (tile) {
    var node = document.createElement('div');
    node.className = this._tileClass;
    node.dataset.id = tile.id;
    node.appendChild(SM.iconFace(this._iconSet, tile.icon));
    this._root.appendChild(node);
    this._tileEls.set(tile.id, node);
    return node;
  };

  /**
   * 全量同步：有条目就显示，从模型消失的节点摘掉。
   * @param {Object} strip 有 toArray() / isFull() 的对象（Tray 或 Holding）
   */
  SlotStripView.prototype.render = function (strip) {
    var self = this;
    var slots = strip.toArray();
    var seen = new Set();

    slots.forEach(function (tile, index) {
      if (!tile) return;
      seen.add(tile.id);
      var node = self._tileEls.get(tile.id) || self._createNode(tile);
      SM.iconFace.update(node.firstChild, self._iconSet, tile.icon);
      node.dataset.slot = String(index);
      // 位置交给 CSS：left = --slot-i * 格距，过渡自带"滑过去"的效果
      node.style.setProperty('--slot-i', index);
    });

    // 满了整排泛红：不是判负，而是"下一步很危险"的预警
    this._root.classList.toggle(this._fullClass, !!strip.isFull());

    // 有牌的格子把虚线框淡掉，避免"三层框"的视觉噪音
    this._slotEls.forEach(function (el, i) {
      el.classList.toggle('is-filled', !!slots[i]);
    });

    // 模型里已经没有的牌：正在播消除动画的留给 clearNodes，其余直接删
    this._tileEls.forEach(function (node, id) {
      if (!seen.has(id) && !node.classList.contains('is-clearing')) {
        node.remove();
        self._tileEls.delete(id);
      }
    });
  };

  /** 消除动画：先标"正在消失"，动画播完再真正删节点 */
  SlotStripView.prototype.clearNodes = function (tileIds, done) {
    var self = this;
    var nodes = [];
    (tileIds || []).forEach(function (id) {
      var node = self._tileEls.get(id);
      if (node) nodes.push(node);
    });
    if (!nodes.length) { if (done) done(); return 0; }

    nodes.forEach(function (n, i) {
      // 错开 30ms 制造节奏（设计 §7.5）
      n.style.animationDelay = (i * 30) + 'ms';
      n.classList.add('is-clearing');
    });
    window.setTimeout(function () {
      nodes.forEach(function (n) {
        n.remove();
        self._tileEls.delete(n.dataset.id);
      });
      if (done) done();
    }, 260 + 60);
    return nodes.length;
  };

  /** "牌被放到这儿了"的闪一下（移出道具落进暂存区时用） */
  SlotStripView.prototype.flashLanding = function (tileIds) {
    var self = this;
    (tileIds || []).forEach(function (id, i) {
      var node = self._tileEls.get(id);
      if (!node) return;
      node.style.animationDelay = (i * 60) + 'ms';
      node.classList.add('is-landing');
      window.setTimeout(function () { node.classList.remove('is-landing'); }, 420 + i * 60);
    });
  };

  SM.SlotStripView = SlotStripView;
})(window.SM = window.SM || {});
