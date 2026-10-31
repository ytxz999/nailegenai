/* ============================================================================
   holding.js —— 模型层：暂存区（Holding）
   它是"移出"道具的落点（R-13 的行为变更）：玩家把槽位里的牌移出来，
   牌不是回到牌堆，而是被单独拿到这里，之后可以再点回槽位。

   为什么单独一个类、不直接复用 Tray：
     · 槽位有 7 格、要判三消（findTriple）、消除后要压紧（compact）；
     · 暂存区只有 3 格、**不参与三消判定**、也不压紧（牌少，看得清就行）。
   把两种语义塞进同一个类，迟早有人对着暂存区调 findTriple 判出个"三消"来。

   为什么暂存区里的牌必须能点回槽位：
   若拿出来的牌就此作废，等于每用一次道具就永久少 3 张；
   "每种图标张数 % 3 === 0"会当场破掉，剩下的一两张永远凑不齐，直接变成死局。
   ========================================================================= */
(function (SM) {
  'use strict';

  var CAPACITY = 3;      // 与"移出最多 3 张"对齐

  function Holding(capacity) {
    var cap = (capacity === undefined) ? CAPACITY : capacity;
    if (!Number.isInteger(cap) || cap < 1) throw new Error('Holding: 容量必须是正整数');
    this._capacity = cap;
    this._slots = new Array(cap);
    for (var i = 0; i < cap; i++) this._slots[i] = null;
  }

  Holding.CAPACITY = CAPACITY;

  Holding.prototype.capacity = function () { return this._capacity; };
  Holding.prototype.slots = function () { return this._slots; };
  Holding.prototype.freeSpace = function () { return this._capacity - this.size(); };

  /** 放到第一个空位；满了返回 −1（调用方负责"用不了道具"的分支） */
  Holding.prototype.append = function (tile) {
    if (!tile) throw new Error('Holding.append: 缺少 tile');
    if (this.indexOf(tile.id) >= 0) throw new Error('Holding.append: ' + tile.id + ' 已在暂存区');
    for (var i = 0; i < this._capacity; i++) {
      if (this._slots[i] === null) { this._slots[i] = tile; return i; }
    }
    return -1;
  };

  Holding.prototype.putAt = function (index, tile) {
    this._checkIndex(index);
    if (this._slots[index] !== null && this._slots[index] !== tile) {
      throw new Error('Holding.putAt: 第 ' + index + ' 格已被 ' + this._slots[index].id + ' 占用');
    }
    this._slots[index] = tile || null;
  };

  Holding.prototype.removeAt = function (index) {
    this._checkIndex(index);
    var t = this._slots[index];
    this._slots[index] = null;
    return t || undefined;
  };

  Holding.prototype.indexOf = function (tileId) {
    for (var i = 0; i < this._capacity; i++) {
      if (this._slots[i] && this._slots[i].id === tileId) return i;
    }
    return -1;
  };

  Holding.prototype.has = function (tileId) { return this.indexOf(tileId) >= 0; };
  Holding.prototype.get = function (index) { this._checkIndex(index); return this._slots[index] || null; };

  Holding.prototype.size = function () {
    var n = 0;
    for (var i = 0; i < this._capacity; i++) if (this._slots[i]) n++;
    return n;
  };

  Holding.prototype.isFull = function () { return this.size() === this._capacity; };
  Holding.prototype.isEmpty = function () { return this.size() === 0; };
  Holding.prototype.toArray = function () { return this._slots.slice(); };

  Holding.prototype.clear = function () {
    for (var i = 0; i < this._capacity; i++) this._slots[i] = null;
  };

  /** 纯数据快照（存档用） */
  Holding.prototype.snapshot = function () {
    return this._slots.map(function (t) { return t ? t.id : null; });
  };

  Holding.prototype._checkIndex = function (index) {
    if (!Number.isInteger(index) || index < 0 || index >= this._capacity) {
      throw new Error('Holding: 格号越界 ' + index);
    }
  };

  SM.Holding = Holding;
})(window.SM = window.SM || {});
