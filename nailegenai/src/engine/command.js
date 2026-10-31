/* ============================================================================
   command.js —— 引擎层：命令（可撤销动作的唯一表达方式）
   为什么用命令模式而不是"每步存一张全量快照"（设计 DD-04）：
     · 快照要把 60～144 张牌全部复制一遍，撤销一次的内存与时间都是 O(n)；
     · 更麻烦的是视图：重建 Tile 对象后，DOM 节点、动画引用、grab 的 rect 全对不上，
       撤销会表现成"牌全部闪一下"。
   命令只记"这一步到底动了什么"，撤销是**照着最小差量反着做一遍**。

   两条硬规矩（DEP-5）：
   1) 命令里只存**值**（id / 图标 / 坐标 / 槽号 / 次数），不存 Tile、Tray、Board 对象。
      存对象就会把"撤销"和"当前这些实例"绑死，读档或重开时命令立刻失效。
   2) 命令不碰视图。撤销后界面怎么变，由 Game 发事件、视图自己决定。
   ========================================================================= */
(function (SM) {
  'use strict';

  /* ------------------------------------------------------------------ 基础 */

  function Command(type, label) {
    this.type = type;
    this.label = label || type;
  }

  /** 子类必须覆盖；基类抛错是为了"漏实现"能当场炸，而不是静默什么都不做 */
  Command.prototype.undo = function () {
    throw new Error('Command: ' + this.type + ' 没有实现 undo');
  };

  Command.prototype.describe = function () {
    return this.type + (this.label ? '（' + this.label + '）' : '');
  };

  /* ------------------------------------------------------ 牌与槽位的值快照 */

  /** Tile → 纯数据。jitter 不入档：它是由 id 哈希算出来的，同样的 id 必然同样的抖动 */
  Command.tileData = function (tile) {
    if (!tile) return null;
    return {
      id: tile.id,
      icon: tile.icon,
      layer: tile.layer,
      col: tile.col,
      row: tile.row,
      group: tile.group
    };
  };

  /** 整个槽位的值快照：null 表示空格，位置即槽号 */
  Command.snapshotSlots = function (tray) {
    return tray.toArray().map(function (t) { return Command.tileData(t); });
  };

  /* ------------------------------------------------------ 暂存区的值快照 */
  /* 暂存区（Holding）与槽位结构相同：定长数组、null 表示空位。
     所以两个快照函数长得一样，但**不合并**：槽位有 7 格且参与三消，
     暂存区 3 格不参与；合并成一个"任意格子容器"会让调用方分不清该传哪个。 */

  Command.snapshotHolding = function (holding) {
    return holding.toArray().map(function (t) { return Command.tileData(t); });
  };

  /**
   * 把暂存区还原成 slots 的样子。
   * @param {Array} aliveList 额外可复用的实例（比如"刚把它从槽里摘出来"的那张牌），
   *        否则 restoreHolding 会再复活一张同 id 的新牌，模型里就出现两张 t004。
   */
  Command.restoreHolding = function (ctx, slots, aliveList) {
    var alive = new Map();
    ctx.holding.toArray().forEach(function (t) { if (t) alive.set(t.id, t); });
    ctx.tray.toArray().forEach(function (t) { if (t) alive.set(t.id, t); });
    (aliveList || []).forEach(function (t) { if (t) alive.set(t.id, t); });

    ctx.holding.clear();
    for (var i = 0; i < slots.length; i++) {
      var data = slots[i];
      if (!data) continue;
      var tile = alive.get(data.id) || ctx.revive(data);
      tile.setState('holding');
      ctx.holding.putAt(i, tile);
    }
  };

  /**
   * 把槽位精确还原成 slots 描述的样子。
   * 优先复用"现在还在槽里的实例"（保住 DOM 引用与动画），
   * 只有在槽里找不到的（已被消除/已被移出的）才用 ctx.revive 复活一张新的。
   */
  Command.restoreSlots = function (ctx, slots, aliveList) {
    var alive = new Map();
    ctx.tray.toArray().forEach(function (t) { if (t) alive.set(t.id, t); });
    (aliveList || []).forEach(function (t) { if (t) alive.set(t.id, t); });

    ctx.tray.clear();
    for (var i = 0; i < slots.length; i++) {
      var data = slots[i];
      if (!data) continue;
      var tile = alive.get(data.id) || ctx.revive(data);
      tile.setState('tray');
      ctx.tray.putAt(i, tile);
    }
  };

  /* --------------------------------------------------- 命令一：点击入槽 */

  /**
   * 一次点击。牌可能来自牌堆，也可能来自暂存区（R-13：移出的牌能点回槽位）。
   * @param {Object} p
   * @param {Object} p.tile        入槽那张牌的值快照（含它在牌堆的坐标）
   * @param {Object} p.from        { layer, col, row }，回牌堆时用
   * @param {Array}  p.trayBefore  点击**之前**的 7 个槽位（值快照）
   * @param {Number} p.cleared     本次点击顺带消除了几张（0 或 3）
   * @param {String} p.source      'board'（默认）或 'holding'
   * @param {Array}  [p.holdingBefore] source === 'holding' 时，点击之前的暂存区快照
   */
  function EnterTrayCommand(p) {
    Command.call(this, 'enter-tray', p.cleared ? '点击并消除' : '点击入槽');
    this.tile = p.tile;
    this.from = p.from;
    this.trayBefore = p.trayBefore;
    this.cleared = p.cleared || 0;
    this.source = p.source || 'board';
    this.holdingBefore = p.holdingBefore || null;
  }
  EnterTrayCommand.prototype = Object.create(Command.prototype);
  EnterTrayCommand.prototype.constructor = EnterTrayCommand;

  /**
   * 反着做一遍。顺序很关键：
   *   ① 先把入槽那张从槽里摘出来（否则它会和 trayBefore 打架）；
   *   ② 再把槽位还原成点击前的样子（这一步会把被消除的牌"复活"回槽里）；
   *   ③ 最后把这张牌放回它的来处 —— 必须最后做，因为 Board.add 要按当时的
   *      牌堆状态重算覆盖计数，先加牌再加槽位会让覆盖计数算进一张"还在槽里"的牌。
   *
   * 注意"这张牌可能已经不在槽里"：如果这次点击本身凑成了三消，
   * 它和另外两张一起被消掉了。所以先查槽，查不到就复活一张——不能直接假定它在。
   */
  EnterTrayCommand.prototype.undo = function (ctx) {
    var slot = ctx.tray.indexOf(this.tile.id);
    var entered = slot >= 0 ? ctx.tray.removeAt(slot) : null;

    Command.restoreSlots(ctx, this.trayBefore, []);

    var back = entered || ctx.revive(this.tile);
    if (this.source === 'holding') {
      // 放回暂存区原格；back 必须作为"可复用实例"传进去，否则会多复活一张
      ctx.holding.clear();
      Command.restoreHolding(ctx, this.holdingBefore, [back]);
    } else {
      back.setState('board');
      ctx.board.add(back);
    }
    ctx.stats.moves -= 1;
    return { ok: true };
  };

  /* ---------------------------------------------------- 命令二：移出道具 */

  /**
   * R-13 之后的"移出"：把槽位前几张牌拿进**暂存区**（不是牌堆）。
   * @param {Object} p
   * @param {Array}  p.removed      [{ tile: 值快照, slotIndex }]，从槽位取走的牌
   * @param {Array}  p.held         [{ id, holdingIndex }]，在暂存区落到第几格
   * @param {Array}  p.trayBefore   用道具之前整槽的样子（值快照）
   * @param {Array}  p.holdingBefore 用道具之前暂存区的样子（值快照）
   */
  function RemoveCommand(p) {
    Command.call(this, 'prop-remove', '移出暂存');
    this.removed = p.removed;
    this.held = p.held || [];
    this.trayBefore = p.trayBefore;
    this.holdingBefore = p.holdingBefore || [];
  }
  RemoveCommand.prototype = Object.create(Command.prototype);
  RemoveCommand.prototype.constructor = RemoveCommand;

  RemoveCommand.prototype.undo = function (ctx) {
    var i;
    // ① 把放进暂存区的牌摘掉（只会摘这一条命令放进去的，别的还留着）
    for (i = 0; i < this.held.length; i++) {
      var at = ctx.holding.indexOf(this.held[i].id);
      if (at >= 0) ctx.holding.removeAt(at);
    }
    // ② 暂存区还原成用道具之前（可能本来就有牌）
    ctx.holding.clear();
    Command.restoreHolding(ctx, this.holdingBefore, []);
    // ③ 槽位还原成用道具之前（这一步同时恢复"被移出"与"被压紧"两种位置变化）
    Command.restoreSlots(ctx, this.trayBefore, []);
    // ④ 次数归还
    ctx.props.refill('remove');
    return { ok: true };
  };

  /* ---------------------------------------------------- 命令三：洗牌道具 */

  /**
   * 只重排**完整组**的图标（设计 DD-06）：某组只要有一张还在槽里，整组不参与交换。
   * 理由：交换图标会改变"哪三张凑得成"，把半组也拿去换，槽里那张就永远凑不齐了。
   * @param {Object} p
   * @param {Map}    p.before  tileId → 旧图标
   */
  function ShuffleCommand(p) {
    Command.call(this, 'prop-shuffle', '洗牌');
    this.before = p.before;
  }
  ShuffleCommand.prototype = Object.create(Command.prototype);
  ShuffleCommand.prototype.constructor = ShuffleCommand;

  ShuffleCommand.prototype.undo = function (ctx) {
    this.before.forEach(function (icon, id) {
      var t = ctx.board.get(id);
      if (t) t.setIcon(icon);      // 洗牌不改坐标，所以直接改图标即可
    });
    ctx.props.refill('shuffle');
    return { ok: true };
  };

  SM.Command = Command;
  SM.EnterTrayCommand = EnterTrayCommand;
  SM.RemoveCommand = RemoveCommand;
  SM.ShuffleCommand = ShuffleCommand;
})(window.SM = window.SM || {});
