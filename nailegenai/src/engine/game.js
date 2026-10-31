/* ============================================================================
   game.js —— 引擎层：Game（编排者，不含规则）
   迭代 2 补上"一次点击"的完整链路（设计 §6.1）：
     state 检查 → 牌还在不在牌堆 → 覆盖判定（Board 说了算）→ 移出牌堆 →
     入槽 → 步数 +1 → 只检测刚入槽的图标有没有凑够 3 张 → 消除结算 →
     判终局 → 发事件。
   它**不**自己判"能不能点"（Board.canPick）、**不**自己判"凑没凑够三张"（Tray.findTriple）：
   规则分别在模型里，Game 只负责按顺序调用、并在中途失败时回滚。
   ========================================================================= */
(function (SM) {
  'use strict';

  var STATE = {
    IDLE: 'Idle',
    READY: 'Ready',
    PLAYING: 'Playing',
    PAUSED: 'Paused',
    WON: 'Won',
    LOST: 'Lost'
  };

  /**
   * @param {Object} opts
   * @param {SM.Board}    opts.board    牌堆
   * @param {SM.Tray}     opts.tray     槽位（迭代 2 起必需）
   * @param {Function}    opts.builder  (config, iconSet) → Tile[]
   * @param {SM.IconSet}  opts.iconSet  可用图标池
   * @param {SM.EventBus} opts.bus      事件总线（可不传）
   */
  function Game(opts) {
    opts = opts || {};
    if (!opts.board) throw new Error('Game: 缺少 board');
    if (!opts.tray) throw new Error('Game: 缺少 tray');
    if (typeof opts.builder !== 'function') throw new Error('Game: 缺少 builder');
    if (!opts.iconSet) throw new Error('Game: 缺少 iconSet');

    this._board = opts.board;
    this._tray = opts.tray;
    // 暂存区（R-13）：移出道具的落点。默认 3 格，与"最多移出 3 张"对齐。
    this._holding = opts.holding || new SM.Holding();
    this._builder = opts.builder;
    this._iconSet = opts.iconSet;
    this._bus = opts.bus || new SM.EventBus();
    this._config = null;
    this._state = STATE.IDLE;
    this._locked = false;
    this._stats = { moves: 0 };
    // 计时器归引擎层：它只认"秒"，不认关卡与界面（设计 §3.16）
    this._timer = opts.timer || new SM.Timer();
    // 道具次数与撤销栈在 startLevel 里按关卡配置新建（迭代 4）。
    // 这里允许注入，是为了自测能塞一个"上限 3 的栈"而不用改关卡配置。
    this._props = opts.props || null;
    this._undoStack = opts.undoStack || null;
  }

  Object.defineProperty(Game.prototype, 'board', { get: function () { return this._board; } });
  Object.defineProperty(Game.prototype, 'tray', { get: function () { return this._tray; } });
  Object.defineProperty(Game.prototype, 'holding', { get: function () { return this._holding; } });
  Object.defineProperty(Game.prototype, 'iconSet', { get: function () { return this._iconSet; } });
  Object.defineProperty(Game.prototype, 'bus', { get: function () { return this._bus; } });
  Object.defineProperty(Game.prototype, 'config', { get: function () { return this._config; } });
  Object.defineProperty(Game.prototype, 'state', { get: function () { return this._state; } });
  Object.defineProperty(Game.prototype, 'stats', { get: function () { return this._stats; } });
  Object.defineProperty(Game.prototype, 'timer', { get: function () { return this._timer; } });
  Object.defineProperty(Game.prototype, 'props', { get: function () { return this._props; } });
  Object.defineProperty(Game.prototype, 'undoStack', { get: function () { return this._undoStack; } });

  /* ------------------------------------------------------------------ 状态 */

  /** 按设计 §3.15 的迁移表判断"这个动作此刻允不允许" */
  Game.prototype.can = function (action) {
    var s = this._state;
    switch (action) {
      case 'select':  return s === STATE.IDLE || this.isTerminal();
      case 'start':   return s === STATE.READY;
      case 'click':   return s === STATE.PLAYING;
      case 'prop':    return s === STATE.PLAYING;
      case 'pause':   return s === STATE.PLAYING;
      case 'resume':  return s === STATE.PAUSED;
      case 'restart': return s !== STATE.IDLE;
      case 'back':    return s !== STATE.IDLE;
      default:        return false;
    }
  };

  Game.prototype.isTerminal = function () {
    return this._state === STATE.WON || this._state === STATE.LOST;
  };

  /**
   * 改状态并发事件。
   * 注意：本方法**不校验**迁移是否合法（P07 走查 S-4 修正了这里的注释——
   * 旧注释写的是"只在合法时才真的改"，与实现不符）。合法性由调用方在动手前
   * 用 `can(action)` 判断；这样 `_transition` 保持成一个无分支的"写 + 通知"，
   * 反过来也方便在 `restore()` 里直接落到某个状态。
   */
  Game.prototype._transition = function (to) {
    this._state = to;
    this._bus.emit(SM.EVENTS.STATE_CHANGED, { state: to });
    return true;
  };

  /** 动画期间上锁：锁期间点击一律静默拒绝（FR-10），否则动画中连点会疯狂抖动 */
  Game.prototype.lock = function () { this._locked = true; };
  Game.prototype.unlock = function () { this._locked = false; };
  Game.prototype.isLocked = function () { return this._locked; };

  /**
   * 按时长上锁，到点自动解锁（P07 走查 M-3）。
   * 为什么不让视图自己 lock/unlock：锁是**模型状态**，视图只该说"我要 320ms"，
   * 不该拥有"什么时候解锁"的决定权。原实现由 Renderer 在动画收尾里 unlock，
   * 一旦动画回调中途抛异常（例如图标节点取不到），unlock 永远走不到，
   * 界面就永久点不动——而这正是 docs/05 风险表里 R-07"动画锁未释放"的形状。
   * 现在解锁由模型的定时器兜底，视图即使炸了也不会把局面锁死。
   * 重复上锁：清掉上一个定时器再起新的，避免旧定时器提前解锁。
   */
  Game.prototype.lockFor = function (ms) {
    var self = this;
    this.lock();
    if (this._lockTimer) window.clearTimeout(this._lockTimer);
    this._lockTimer = window.setTimeout(function () {
      self._lockTimer = null;
      self.unlock();
    }, Math.max(0, ms || 0));
    return this._lockTimer;
  };

  /* ------------------------------------------------------------------ 开局 */

  Game.prototype.startLevel = function (config) {
    if (!config) throw new Error('Game.startLevel: 缺少关卡配置');

    var errs = config.validate ? config.validate() : [];
    if (errs.length) throw new Error('Game.startLevel: 配置不合法 → ' + errs.join('；'));

    this._board.clear();
    this._tray.clear();
    this._holding.clear();

    var tiles = this._builder(config, this._iconSet);
    if (tiles.length !== config.tileCount) {
      throw new Error('Game.startLevel: builder 出了 ' + tiles.length +
                      ' 张牌，配置声明 ' + config.tileCount + ' 张');
    }

    /* 按层号升序入堆。Board.add 本身是双向维护覆盖计数的，顺序并非必需；
       但自下而上入堆能让"索引在构建过程中就始终自洽"。 */
    tiles.sort(function (a, b) { return a.layer - b.layer; });
    for (var i = 0; i < tiles.length; i++) this._board.add(tiles[i]);

    this._config = config;
    this._stats = { moves: 0 };
    // 道具次数与撤销栈上限都来自关卡配置（迭代 4），不允许在代码里写死
    this._props = new SM.PropManager(config.props);
    this._undoStack = new SM.UndoManager(config.undoStackLimit);
    this._state = STATE.READY;
    // 计时从"首帧渲染完成"开始（设计 §3.16）：本方法返回前牌堆已经全部入堆，
    // 视图紧接着就会渲染，所以在这里起表与实际观感没有可感知的偏差。
    this._timer.reset().start();
    this._transition(STATE.PLAYING);

    this._bus.emit(SM.EVENTS.LEVEL_STARTED, { config: config, tiles: tiles });
    this._bus.emit(SM.EVENTS.BOARD_CHANGED, { reason: 'start' });
    this._bus.emit(SM.EVENTS.TRAY_CHANGED, { reason: 'start' });
    return { ok: true, count: tiles.length };
  };

  /* ---------------------------------------------------------------- 恢复 */

  /**
   * 从存档恢复一局（迭代 5，设计 §5.2 / E-07）。
   * 为什么由 Game 来做、而不是 Repository：
   *   Repository 只搬纯数据（D-10），把 `{id, icon, layer...}` 变成 Tile 实例
   *   属于"重建对象图"，只有 Game 手里同时有 Board / Tray / Props / Timer。
   *
   * 恢复顺序刻意与"开始新局"一致：先清容器、再按层升序入堆、最后放槽位。
   * 反过来的话，先放槽位会让 Board.add 的覆盖计算把一张"其实在槽里"的牌算进去。
   */
  Game.prototype.restore = function (data) {
    if (!data) throw new Error('Game.restore: 缺少存档数据');
    var config = SM.levels.byId(data.levelId);
    if (!config) throw new Error('Game.restore: 未知关卡 ' + data.levelId);

    this._board.clear();
    this._tray.clear();
    this._holding.clear();

    var boardTiles = [];
    var trayTiles = [];
    data.tiles.forEach(function (d) {
      var t = new SM.Tile(d.id, d.icon, d.layer, d.col, d.row, d.group);
      // holding 的牌也不在牌堆里：它被"移出"单独拿出来了（R-13）
      if (d.state === 'tray' || d.state === 'holding') trayTiles.push(t);
      else boardTiles.push(t);
    });

    boardTiles.sort(function (a, b) { return a.layer - b.layer; });
    for (var i = 0; i < boardTiles.length; i++) this._board.add(boardTiles[i]);

    // 槽位按存档里的槽号原样放回：中间的空格必须留住，
    // 否则"压紧前移"会把恢复后的槽位顺序变得和存档前不同（R-09 的坑）。
    var byId = {};
    trayTiles.forEach(function (t) { byId[t.id] = t; });
    for (var slot = 0; slot < data.tray.length; slot++) {
      var id = data.tray[slot];
      if (!id) continue;
      var tile = byId[id];
      if (!tile) continue;      // 存档里 tray 与 tiles 不自洽时跳过，不让整局报废
      tile.placeAt(tile.layer, tile.col, tile.row);
      tile.setState('tray');
      this._tray.putAt(slot, tile);
    }

    // 暂存区：同样按存档里的格号原样放回（R-13）。缺字段的老存档按空处理，不让整局报废。
    var held = Array.isArray(data.holding) ? data.holding : [];
    for (var hi = 0; hi < held.length; hi++) {
      var hid = held[hi];
      if (!hid) continue;
      var htile = byId[hid];
      if (!htile) continue;
      htile.placeAt(htile.layer, htile.col, htile.row);
      htile.setState('holding');
      this._holding.putAt(hi, htile);
    }

    this._config = config;
    this._stats = { moves: data.moves || 0 };
    this._props = new SM.PropManager(data.props, data.propsInitial);
    // 撤销栈不进存档（DD-06）：刷新后从空栈开始，按钮会置灰
    this._undoStack = new SM.UndoManager(config.undoStackLimit);
    this._state = STATE.READY;

    // 读档入口也必须有守门人（P07 走查 M-2）：
    // Repository 只校验"结构"（tiles 是数组、tray 长度 7、版本号、configHash），
    // 校验不了"张数是不是 3 的倍数""每种图标是不是刚好 perIconCount 张"。
    // 少了这几条的后果不是崩溃，而是**静默必死**——玩家能点能消，最后剩 1～2 张
    // 永远凑不齐，看起来像"这关设计得有问题"。所以这里补一次全量自检，
    // 不通过就抛错，由 main.js 走已有的"存档已失效，已重新开始"分支。
    var check = this.assertInvariants();
    if (!check.ok) {
      var bad = (check.checks || []).filter(function (c) { return !c.ok; })
        .map(function (c) { return c.name + '：' + c.detail; }).join('；');
      throw new Error('Game.restore: 存档不自洽（' + bad + '）');
    }

    this._timer.reset();
    var elapsed = Math.max(0, data.elapsedMs || 0);
    if (elapsed > 0) this._timer.setElapsed(elapsed);
    this._timer.start();

    this._transition(STATE.PLAYING);
    this._bus.emit(SM.EVENTS.LEVEL_STARTED, { config: config, restored: true });
    this._bus.emit(SM.EVENTS.BOARD_CHANGED, { reason: 'restore' });
    this._bus.emit(SM.EVENTS.TRAY_CHANGED, { reason: 'restore' });
    this._bus.emit(SM.EVENTS.PROPS_CHANGED, { reason: 'restore' });
    return { ok: true, boardSize: this._board.size(), traySize: this._tray.size() };
  };

  /* ------------------------------------------------------------------ 点击 */

  /**
   * 唯一的点击入口（设计 §6.1）。返回 ActionResult，视图只看结果放动画：
   *   { ok, kind:'enter'|'clear'|'reject'|'noop', reason?, slotIndex?, clearedTileIds? }
   *
   * 原子性怎么保证：所有"会不会失败"的判断都在动手之前做完（第 1～5 步），
   * 动手之后唯一可能失败的只剩"入槽返回 −1"（槽满），那一步带完整回滚。
   * 因此外部永远看不到"牌从牌堆消失却没进槽"这种半截状态。
   */
  Game.prototype.clickTile = function (tileId) {
    // 1. 状态闸门
    if (!this.can('click')) {
      return { ok: false, kind: 'noop', reason: 'state:' + this._state };
    }
    // 2. 动画锁：静默拒绝，不发任何事件（避免动画期间连点弹噪音）
    if (this._locked) {
      return { ok: false, kind: 'noop', reason: 'locked' };
    }
    // 3. 这张牌还在牌堆里吗（可能已经在槽位、已消除，或 DOM 已过期）
    //    先看暂存区：移出的牌不在牌堆里，但它是**唯一允许点回槽位**的一类特殊牌（R-13）
    var heldAt = this._holding.indexOf(tileId);
    if (heldAt >= 0) return this._clickHeld(tileId, heldAt);

    var tile = this._board.get(tileId);
    if (!tile) return { ok: false, kind: 'noop', reason: 'not-on-board' };

    // 4. 覆盖判定：Board 说了算，返回布尔，不掺任何 DOM 信息
    if (!this._board.canPick(tileId)) {
      this._bus.emit(SM.EVENTS.TILE_REJECTED, { tileId: tileId, reason: 'covered' });
      return { ok: false, kind: 'reject', reason: 'covered' };
    }

    // 5. 槽位还有地方吗（正常情况判不到这里：槽满时上一次点击就该判负了）
    if (this._tray.isFull()) {
      this._bus.emit(SM.EVENTS.TILE_REJECTED, { tileId: tileId, reason: 'tray-full' });
      return { ok: false, kind: 'reject', reason: 'tray-full' };
    }

    // ---- 以下是"动手"：从这里开始，任何失败都必须回滚 ----
    var from = { layer: tile.layer, col: tile.col, row: tile.row };
    // 撤销需要"动作之前的整槽样子"：单记一个槽号不够，因为消除会把后面的牌压紧，
    // 撤销时不仅要放回这一张，还得把被压紧的那些还原到原位（R-09 的行为变更）。
    var trayBefore = SM.Command.snapshotSlots(this._tray);
    this._board.remove(tile);

    var slotIndex = this._tray.append(tile);
    if (slotIndex < 0) {
      // 回滚：把牌放回原处，绝不让它凭空消失（设计 §6.1 陷阱 1）
      this._board.add(tile);
      console.error('Game.clickTile: 槽位已满却入槽，已回滚', tileId);
      return { ok: false, kind: 'reject', reason: 'tray-full-rollback' };
    }

    tile.setState('tray');
    this._stats.moves += 1;

    return this._finishEntry(tile, slotIndex, from, trayBefore, { source: 'board' });
  };

  /**
   * 从暂存区点一张牌回槽位（R-13）。
   * 与"从牌堆点牌"共用同一套收尾（_finishEntry），差别只有两处：
   *   · 牌是从暂存区摘下来的，不是从 Board.remove 的；
   *   · 撤销时要把它放回暂存区原格，而不是牌堆原位。
   */
  Game.prototype._clickHeld = function (tileId, holdingIndex) {
    // 5'. 槽位还有地方吗（暂存区的牌回槽同样受 BR-02 约束）
    if (this._tray.isFull()) {
      this._bus.emit(SM.EVENTS.TILE_REJECTED, { tileId: tileId, reason: 'tray-full' });
      return { ok: false, kind: 'reject', reason: 'tray-full' };
    }

    var tile = this._holding.get(holdingIndex);
    if (!tile) return { ok: false, kind: 'noop', reason: 'not-in-holding' };

    var trayBefore = SM.Command.snapshotSlots(this._tray);
    var holdingBefore = SM.Command.snapshotHolding(this._holding);

    // 牌堆坐标原样留着：撤销回暂存区时不需要它，但存档/复活要能复原这张牌
    var from = { layer: tile.layer, col: tile.col, row: tile.row };

    this._holding.removeAt(holdingIndex);
    var slotIndex = this._tray.append(tile);
    if (slotIndex < 0) {
      // 回滚：放回暂存区原格，绝不让牌凭空消失
      this._holding.putAt(holdingIndex, tile);
      console.error('Game._clickHeld: 槽位已满却入槽，已回滚', tileId);
      return { ok: false, kind: 'reject', reason: 'tray-full-rollback' };
    }

    tile.setState('tray');
    this._stats.moves += 1;

    return this._finishEntry(tile, slotIndex, from, trayBefore, {
      source: 'holding',
      holdingBefore: holdingBefore
    });
  };

  /**
   * 入槽之后的公共收尾：三消 → 发事件 → 判终局 → 入撤销栈 → 组返回值。
   * 牌堆入口与暂存区入口都走这里 —— 否则"两套三消逻辑"迟早分叉，
   * 而三消是这游戏最容易算错的一段（BR-03 / R-09 的压紧都在里面）。
   */
  Game.prototype._finishEntry = function (tile, slotIndex, from, trayBefore, extra) {
    extra = extra || {};
    var source = extra.source || 'board';

    // 三消：只检测刚入槽那张牌的图标（BR-03，不做连锁）
    var clearedIds = [];
    var clearedSlots = [];
    var triple = this._tray.findTriple(tile.icon);
    if (triple.length === 3) {
      for (var i = 0; i < triple.length; i++) {
        var t = this._tray.removeAt(triple[i]);
        if (t) { t.setState('cleared'); clearedIds.push(t.id); }
      }
      clearedSlots = triple.slice();
      // 消除后把剩下的牌压紧到前面几格（R-09 的行为变更）：
      // 不压紧的话，空格会一直留在中间，新牌优先填进那个洞，
      // 玩家看到的就是"后面的牌永远补不上来"。
      // 注意 clearedSlots 记的是**压紧之前**的槽号，动画要用它定位消失的那三张。
      this._tray.compact();
    }

    // 事件顺序固定：先入槽后消除，动画要按这个顺序播
    this._bus.emit(SM.EVENTS.TILE_ENTERED, {
      tileId: tile.id, slotIndex: slotIndex, from: from, source: source
    });
    if (clearedIds.length) {
      this._bus.emit(SM.EVENTS.TILES_CLEARED, { tileIds: clearedIds, icon: tile.icon });
    }
    this._bus.emit(SM.EVENTS.BOARD_CHANGED, { reason: 'click' });
    this._bus.emit(SM.EVENTS.TRAY_CHANGED, { reason: 'click' });
    if (source === 'holding') {
      this._bus.emit(SM.EVENTS.PROPS_CHANGED, { reason: 'holding' });
    }

    // 判终局（顺序不能反：先结算消除，再判失败，否则"第 7 张恰好三消"会被误判负）
    this._judgeTerminal(clearedIds.length > 0);

    // 入撤销栈：只有"真的改变了状态"的点击才入栈（被拒的点击在上面就 return 了）
    var cmdOpts = {
      tile: SM.Command.tileData(tile),
      from: from,
      trayBefore: trayBefore,
      cleared: clearedIds.length,
      source: source
    };
    if (extra.holdingBefore) cmdOpts.holdingBefore = extra.holdingBefore;
    this._undoStack.push(new SM.EnterTrayCommand(cmdOpts));

    return {
      ok: true,
      kind: clearedIds.length ? 'clear' : 'enter',
      slotIndex: slotIndex,
      icon: tile.icon,
      from: from,
      source: source,
      clearedTileIds: clearedIds,
      clearedSlots: clearedSlots,
      stateChanged: this.isTerminal()
    };
  };

  /**
   * 终局判定（FR-13/14、BR-02）。
   * 失败条件必须由"槽位满 7 **且** 本次入槽没有产生消除"推导出来，
   * 不能写成"点了 7 次就输"——第 7 张恰好凑成三消时槽位只剩 4 张，游戏应当继续。
   */
  Game.prototype._judgeTerminal = function (clearedThisTurn) {
    if (this.isTerminal()) return;

    if (this._board.size() === 0 && this._tray.size() === 0 && this._holding.size() === 0) {
      this._timer.stop();          // 终局先停表，结算页显示的才是"定格"的时长
      this._transition(STATE.WON);
      return;
    }
    if (this._tray.isFull() && !clearedThisTurn) {
      this._timer.stop();
      this._transition(STATE.LOST);
    }
  };

  /** 手工判定入口：验收要求"控制台可手工调用判定函数验证边界" */
  Game.prototype.judgeNow = function () {
    this._judgeTerminal(false);
    return this._state;
  };

  /* ------------------------------------------------------------------ 道具 */

  /**
   * 命令执行时能拿到的东西（迭代 4）。
   * 命令不认识 Game、也不认识视图，只认这个上下文——
   * 这样命令类可以被自测单独驱动，不需要先起一个完整的 Game。
   */
  Game.prototype._ctx = function () {
    var self = this;
    return {
      board: this._board,
      tray: this._tray,
      holding: this._holding,
      props: this._props,
      stats: this._stats,
      revive: function (data) { return self._reviveTile(data); }
    };
  };

  /** 用值快照复活一张牌；抖动是由 id 哈希算出来的，所以复活后的外观与原来一致 */
  Game.prototype._reviveTile = function (data) {
    if (!data) throw new Error('Game._reviveTile: 缺少牌数据');
    return new SM.Tile(data.id, data.icon, data.layer, data.col, data.row, data.group);
  };

  /**
   * 道具统一入口（FR-16～20）。三种道具**都通过命令**改变状态，
   * 所以每一种都能被撤销，撤销时次数自动归还（命令自己 refill）。
   *
   * @param {String} kind 'undo' | 'remove' | 'shuffle'
   * @returns {{ok:Boolean, kind:String, propKind:String, reason:String, counts:Object, detail:Object}}
   */
  Game.prototype.useProp = function (kind) {
    // 道具清单只有一张表（P07 走查 S-1）：kind → { label, glyph, method }。
    // 原来这里是 if (kind === 'undo') … else if (kind === 'remove') … else …，
    // 加第四种道具就得改这里 + PropManager + PropBar + sound + main 五处，
    // 而少改一处不会报错，只会静默走到"最后一个 else"（即洗牌）。现在不会了。
    var spec = SM.PropTable ? SM.PropTable.get(kind) : null;
    if (!spec) {
      return { ok: false, kind: 'noop', reason: 'unknown-prop' };
    }
    if (!this.can('prop')) return { ok: false, kind: 'noop', reason: 'state:' + this._state };
    if (this._locked) return { ok: false, kind: 'noop', reason: 'locked' };
    if (!this._props) return { ok: false, kind: 'noop', reason: 'no-level' };

    var usable = this._props.canUse(kind);
    if (!usable.ok) {
      return { ok: false, kind: 'reject', propKind: kind, reason: usable.reason };
    }

    var handler = this[spec.method];
    if (typeof handler !== 'function') {
      throw new Error('Game.useProp: 登记表把 ' + kind + ' 指向了不存在的方法 ' + spec.method);
    }
    var res = handler.call(this);

    if (!res.ok) {
      return { ok: false, kind: 'reject', propKind: kind, reason: res.reason, report: res.report };
    }

    // 道具不增步数：步数的口径是"入槽次数"（FR-15），道具不往槽里放牌
    this._bus.emit(SM.EVENTS.PROPS_CHANGED, { kind: kind, counts: this._props.counts() });
    this._bus.emit(SM.EVENTS.BOARD_CHANGED, { reason: kind });
    this._bus.emit(SM.EVENTS.TRAY_CHANGED, { reason: kind });

    return {
      ok: true,
      kind: 'prop',
      propKind: kind,
      counts: this._props.counts(),
      detail: res,
      stateChanged: this.isTerminal()
    };
  };

  /** 撤销：栈顶命令 undo()，然后扣一次"撤销"次数 */
  Game.prototype._undoOne = function () {
    if (!this._undoStack.canUndo()) return { ok: false, reason: 'empty-stack' };
    var res = this._undoStack.undo(this._ctx());
    if (!res.ok) return res;

    this._props.consume('undo');

    // 撤销可能把局面从终局拉回来（典型：最后一步把槽点满判负，撤销后应当能继续玩）
    if (this.isTerminal()) {
      this._transition(STATE.PLAYING);
      this._timer.resume();
    }
    return { ok: true, undone: res.cmd.type };
  };

  /**
   * 移出：把槽位里**最早的**最多 3 张拿进暂存区（FR-18 / BR-07 / R-13）。
   * 为什么不放回牌堆：放回牌堆等于"牌没少，只是位置变高"，
   * 玩家感受不到"这 3 张被我暂时收起来了"；而且牌堆顶层会凭空多出一层，
   * 打乱原有的层叠观感。暂存区是"单独拿出来"，看得见、还点得回去。
   */
  Game.prototype._removeThree = function () {
    if (this._tray.size() === 0) return { ok: false, reason: 'tray-empty' };
    var free = this._holding.freeSpace();
    if (free <= 0) return { ok: false, reason: 'holding-full' };

    var trayBefore = SM.Command.snapshotSlots(this._tray);
    var holdingBefore = SM.Command.snapshotHolding(this._holding);

    var want = Math.min(3, free);
    var taken = this._tray.takeFirst(want);        // 按槽序取，最多 3 张
    this._tray.compact();                          // 取走之后同样要压紧（R-09 口径一致）

    var held = [];
    for (var i = 0; i < taken.length; i++) {
      var t = taken[i].tile;
      t.setState('holding');
      var at = this._holding.append(t);
      held.push({ id: t.id, holdingIndex: at });
    }

    this._props.consume('remove');
    this._undoStack.push(new SM.RemoveCommand({
      removed: taken.map(function (item) {
        return { tile: SM.Command.tileData(item.tile), slotIndex: item.index };
      }),
      held: held,
      trayBefore: trayBefore,
      holdingBefore: holdingBefore
    }));

    return { ok: true, held: held, count: taken.length };
  };

  /**
   * 洗牌：只在**完整组**之间交换图标（FR-19 / BR-08 / DD-06）。
   * 三条硬要求都在这一个函数里体现：
   *   · 位置与覆盖关系不动 —— 只赋 icon，不碰 layer/col/row；
   *   · 3 的倍数不变量不被破坏 —— 整组一起换，每种图标的张数不变；
   *   · 洗后可解 —— 换的是"整组"，可解序列依然成立（只是换了图标名字）；
   *   · 洗后必须重跑自检，不过就当场回滚，绝不留一个坏局面。
   */
  Game.prototype._shuffleIcons = function () {
    var byGroup = new Map();
    this._board.all().forEach(function (t) {
      var arr = byGroup.get(t.group);
      if (!arr) { arr = []; byGroup.set(t.group, arr); }
      arr.push(t);
    });

    var groups = [];
    byGroup.forEach(function (arr) {
      // 该组 3 张必须都在牌堆里：有一张在槽位时，把它那组的图标换走就永远凑不齐了
      if (arr.length === 3) groups.push(arr);
    });
    if (groups.length < 2) return { ok: false, reason: 'no-groups' };

    var icons = groups.map(function (arr) { return arr[0].icon; });
    var mixed = icons.slice();
    for (var attempt = 0; attempt < 8; attempt++) {
      mixed = icons.slice();
      for (var i = mixed.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = mixed[i]; mixed[i] = mixed[j]; mixed[j] = tmp;
      }
      if (mixed.some(function (v, k) { return v !== icons[k]; })) break;
    }
    if (!mixed.some(function (v, k) { return v !== icons[k]; })) {
      mixed = icons.slice(1).concat([icons[0]]);   // 兜底：整体轮转一格
    }

    var before = new Map();
    var self = this;
    groups.forEach(function (arr, k) {
      arr.forEach(function (t) {
        before.set(t.id, t.icon);
        t.setIcon(mixed[k]);
      });
    });

    // 用整关口径（含槽位）自检：洗牌时槽位里通常有牌，
    // 只查牌堆会让 I-4 误报，把一次合法洗牌当成"破坏了不变量"回滚掉。
    var report = this.assertInvariants();
    if (!report.ok) {
      before.forEach(function (icon, id) {
        var t = self._board.get(id);
        if (t) t.setIcon(icon);
      });
      return { ok: false, reason: 'invariant', report: report };
    }

    this._props.consume('shuffle');
    this._undoStack.push(new SM.ShuffleCommand({ before: before }));
    // before 一起返回：视图要先把牌面摆回"洗牌前"，等牌聚拢了再换成新图标，
    // 否则玩家看到的是"图标闪一下 + 牌抖两下"，不像洗牌（R-12）。
    return { ok: true, groups: groups.length, report: report, before: before };
  };

  /* ------------------------------------------------------------ 暂停与重开 */

  /**
   * 暂停：只有 Playing 能暂停。
   * 顺序是"先停表再改状态"——反过来的话，一旦状态变了、界面重绘卡一下，
   * 表还在走，玩家会看到暂停面板上的时间又跳了一两秒。
   */
  Game.prototype.pause = function () {
    if (!this.can('pause')) return { ok: false, reason: 'state:' + this._state };
    this._timer.pause();
    this._transition(STATE.PAUSED);
    return { ok: true, state: this._state };
  };

  Game.prototype.resume = function () {
    if (!this.can('resume')) return { ok: false, reason: 'state:' + this._state };
    this._transition(STATE.PLAYING);
    this._timer.resume();
    return { ok: true, state: this._state };
  };

  /** 重开当前关：牌堆、槽位、计时、步数全部回到开局 */
  Game.prototype.restart = function () {
    if (!this._config) return { ok: false, reason: 'no-level' };
    return this.startLevel(this._config);
  };

  /** 视图只读这个，别去翻 board/tray 的内部结构 */
  Game.prototype.snapshot = function () {
    return {
      state: this._state,
      moves: this._stats.moves,
      levelId: this._config ? this._config.id : null,
      levelName: this._config ? this._config.name : '—',
      levelLayers: this._config ? this._config.layers : 0,
      remaining: this._board.size() + this._tray.size() + this._holding.size(),
      boardSize: this._board.size(),
      traySize: this._tray.size(),
      holdingSize: this._holding.size(),
      elapsedMs: this._timer.elapsedMs(),
      traySlots: this._tray.toArray(),
      holdingSlots: this._holding.toArray(),
      props: this._props ? this._props.counts() : null,
      canUndo: this._undoStack ? this._undoStack.size() : 0
    };
  };

  /* ---------------------------------------------------------------- 调试 */

  Game.prototype.debugCount = function () { return this._board.debugCount(); };

  /**
   * 整关的不变式自检：Board 的五条 + 把槽位里的牌也计入 I-4。
   * 为什么 Game 来组合：I-4 的口径是"整关每种图标 3 的倍数"，
   * 而槽位属于另一个对象 —— 只有 Game 同时认识两者（D-05 不让 Board 认识 Tray）。
   */
  Game.prototype.assertInvariants = function () {
    var perIcon = {};
    this._tray.toArray().forEach(function (t) {
      if (t) perIcon[t.icon] = (perIcon[t.icon] || 0) + 1;
    });
    // 暂存区的牌同样"还在场上"：不并进来，I-4 会在用掉一次移出后误报
    this._holding.toArray().forEach(function (t) {
      if (t) perIcon[t.icon] = (perIcon[t.icon] || 0) + 1;
    });
    return this._board.assertInvariants(perIcon);
  };

  Game.STATE = STATE;
  SM.Game = Game;
})(window.SM = window.SM || {});
