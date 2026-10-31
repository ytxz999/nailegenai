/* ============================================================================
   tray.js —— 模型层：槽位（Tray）
   职责边界（分析 §2 / 设计 §3.4）：
     · 只做两件事：管 7 个格子里放的是谁、以及"同图标够 3 张了没有"；
     · 不判胜负（胜负由 Game 下结论，D-04），不计步，不碰 DOM，不认识计时器；
     · 槽位**允许有洞**：消除只把命中的 3 格置 null；是否把后面的牌往前挪，
       由调用方决定（Game 在消除后调 compact()，否则空格会留在中间、
       新牌优先填洞，看起来就是"后面的牌永远补不上来"）。
   ========================================================================= */
(function (SM) {
  'use strict';

  var CAPACITY = 7;      // 设计 §3.4 / BR-02

  function Tray(capacity) {
    var cap = (capacity === undefined) ? CAPACITY : capacity;
    if (!Number.isInteger(cap) || cap < 1) throw new Error('Tray: 容量必须是正整数');
    this._capacity = cap;
    this._slots = new Array(cap);
    for (var i = 0; i < cap; i++) this._slots[i] = null;
  }

  Tray.CAPACITY = CAPACITY;

  Tray.prototype.capacity = function () { return this._capacity; };
  Tray.prototype.slots = function () { return this._slots; };

  /** 放牌：填第一个 null 位置（撤销留下的洞会被优先补上），满了返回 −1 */
  Tray.prototype.append = function (tile) {
    if (!tile) throw new Error('Tray.append: 缺少 tile');
    if (this.indexOf(tile.id) >= 0) throw new Error('Tray.append: ' + tile.id + ' 已在槽位中');
    for (var i = 0; i < this._capacity; i++) {
      if (this._slots[i] === null) { this._slots[i] = tile; return i; }
    }
    return -1;   // 满：调用方负责回滚（设计 §6.1 第 7 步）
  };

  /**
   * 直接放到指定格（撤销/移出道具恢复用）。
   * 格子里已有别的牌时不做"挤走"——那是调用方算错了，早死早查。
   */
  Tray.prototype.putAt = function (index, tile) {
    this._checkIndex(index);
    if (this._slots[index] !== null && this._slots[index] !== tile) {
      throw new Error('Tray.putAt: 槽位 ' + index + ' 已被 ' + this._slots[index].id + ' 占用');
    }
    this._slots[index] = tile || null;
  };

  Tray.prototype.removeAt = function (index) {
    this._checkIndex(index);
    var t = this._slots[index];
    this._slots[index] = null;
    return t || undefined;
  };

  /** 取最早 count 张（按槽序、跳过空格），用于"移出"道具（FR-18） */
  Tray.prototype.takeFirst = function (count) {
    var taken = [];
    for (var i = 0; i < this._capacity && taken.length < count; i++) {
      if (this._slots[i]) { taken.push({ index: i, tile: this._slots[i] }); this._slots[i] = null; }
    }
    return taken;
  };

  /**
   * 三消检测（BR-03）：只找**指定图标**的 3 个槽号，不扫全槽。
   * 一次入槽最多让一个图标达到 3 张，全槽扫描是多余工作，
   * 而且会留下"一次触发两组消除"的口子，与 BR-03 冲突。
   */
  Tray.prototype.findTriple = function (icon) {
    var hits = [];
    for (var i = 0; i < this._capacity; i++) {
      var t = this._slots[i];
      if (t && t.icon === icon) {
        hits.push(i);
        if (hits.length === 3) return hits;
      }
    }
    return [];
  };

  /** 某图标当前有几张（控制台排查用，也方便写自检） */
  Tray.prototype.countOf = function (icon) {
    var n = 0;
    for (var i = 0; i < this._capacity; i++) {
      var t = this._slots[i];
      if (t && t.icon === icon) n++;
    }
    return n;
  };

  Tray.prototype.indexOf = function (tileId) {
    for (var i = 0; i < this._capacity; i++) {
      if (this._slots[i] && this._slots[i].id === tileId) return i;
    }
    return -1;
  };

  Tray.prototype.get = function (index) {
    this._checkIndex(index);
    return this._slots[index] || null;
  };

  Tray.prototype.size = function () {
    var n = 0;
    for (var i = 0; i < this._capacity; i++) if (this._slots[i]) n++;
    return n;
  };

  Tray.prototype.isFull = function () { return this.size() === this._capacity; };
  Tray.prototype.isEmpty = function () { return this.size() === 0; };

  /** 渲染用副本（null 保留，槽位编号即视觉位置） */
  Tray.prototype.toArray = function () { return this._slots.slice(); };

  /** 压实：把牌往左挤，中间不留洞（消除后、"移出"道具后都调） */
  Tray.prototype.compact = function () {
    var kept = [];
    for (var i = 0; i < this._capacity; i++) if (this._slots[i]) kept.push(this._slots[i]);
    for (i = 0; i < this._capacity; i++) this._slots[i] = kept[i] || null;
  };

  Tray.prototype.clear = function () {
    for (var i = 0; i < this._capacity; i++) this._slots[i] = null;
  };

  /** 纯数据快照（存档用，只存 id；迭代 5 才用得上） */
  Tray.prototype.snapshot = function () {
    return this._slots.map(function (t) { return t ? t.id : null; });
  };

  Tray.prototype.restore = function (ids, lookup) {
    if (!Array.isArray(ids)) throw new Error('Tray.restore: 需要数组');
    this.clear();
    for (var i = 0; i < Math.min(ids.length, this._capacity); i++) {
      if (ids[i]) this._slots[i] = lookup(ids[i]) || null;
    }
  };

  Tray.prototype._checkIndex = function (index) {
    if (!Number.isInteger(index) || index < 0 || index >= this._capacity) {
      throw new Error('Tray: 槽号越界 ' + index);
    }
  };

  SM.Tray = Tray;
})(window.SM = window.SM || {});
