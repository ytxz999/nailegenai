/* ============================================================================
   repository.js —— 数据层：存档 / 最佳记录 / 设置
   职责边界（设计 §3.12、分析 D-10）：
     · 只搬**纯数据**：不 new Tile、不碰 DOM、不认 Game 的私有字段；
     · 只做"业务语义"：存什么、怎么裁剪、坏了怎么办；介质细节交给 StorageAdapter；
     · 读出后由 Game.restore() 重建实例 —— 存档格式因此与类结构解耦，
       以后给 Tile 加字段不会让旧档全废。
   刻意不存的三样（设计 §5.2）：撤销栈、抖动、可解序列。
   ========================================================================= */
(function (SM) {
  'use strict';

  var schema = SM.schema;

  function Repository(adapter) {
    this._db = adapter;
    this.lastError = null;   // 供界面提示用：'unavailable' | 'quota' | 'dirty' | 'version' | 'config'
  }

  /* ------------------------------------------------------------------ 存档 */

  /** 把一局拍平成纯对象。game 侧只读公开结构，不改 Game 一行代码。 */
  Repository.prototype.serializeGame = function (game) {
    var board = game.board, tray = game.tray, holding = game.holding;
    var tiles = [];

    board.all().forEach(function (t) {
      tiles.push({ id: t.id, icon: t.icon, layer: t.layer, col: t.col, row: t.row, state: 'board', group: t.group });
    });
    tray.toArray().forEach(function (t) {
      if (t) tiles.push({ id: t.id, icon: t.icon, layer: t.layer, col: t.col, row: t.row, state: 'tray', group: t.group });
    });
    // 暂存区的牌（R-13）：state 记为 'holding'，恢复时才会回到暂存区而不是牌堆
    if (holding) {
      holding.toArray().forEach(function (t) {
        if (t) tiles.push({ id: t.id, icon: t.icon, layer: t.layer, col: t.col, row: t.row, state: 'holding', group: t.group });
      });
    }

    return {
      v: schema.VERSION,
      savedAt: Date.now(),
      levelId: game.config.id,
      configHash: schema.configHash(game.config),
      // 只有 Playing / Paused 会进存档；Won/Lost 走 clearGame
      status: game.state === 'Paused' ? 'Paused' : 'Playing',
      elapsedMs: game.timer.elapsedMs(),
      moves: game.stats.moves,
      props: game.props.counts(),
      propsInitial: game.props.initialCounts(),
      tiles: tiles,
      tray: tray.toArray().map(function (t) { return t ? t.id : null; }),
      holding: holding ? holding.toArray().map(function (t) { return t ? t.id : null; }) : [],
      maxLayer: board.maxLayer(),
      // 溢出层：v1 的"移出放回牌堆"会新开一层；R-13 之后不再新开层，
      // 这个字段保留是为了让旧存档仍能被识别（值为空数组即正常局面）
      overflowLayers: overflowLayersOf(game)
    };
  };

  function overflowLayersOf(game) {
    var baseLayers = game.config.layers;
    var out = [];
    for (var l = baseLayers; l <= game.board.maxLayer(); l++) out.push(l);
    return out;
  }

  Repository.prototype.saveGame = function (game) {
    if (!this._db.isAvailable()) { this.lastError = 'unavailable'; return false; }
    if (!game || !game.config) return false;
    var ok = this._db.write(schema.KEYS.save, this.serializeGame(game));
    this.lastError = ok ? null : 'quota';
    return ok;
  };

  Repository.prototype.hasSave = function () {
    return !!this._db.read(schema.KEYS.save);
  };

  /**
   * 读档：版本、关卡参数指纹、结构三层都过一遍，任何一层不过就返回 null
   * 并**清掉该键**（设计 E-07：坏档留着只会每次都弹同一个错）。
   */
  Repository.prototype.loadGame = function () {
    var raw = this._db.read(schema.KEYS.save);
    if (!raw) return null;

    if (!schema.isPlainObject(raw) || raw.v !== schema.VERSION) {
      this.lastError = 'version';
      this.clearGame();
      return null;
    }
    if (!Array.isArray(raw.tiles) || !Array.isArray(raw.tray) || raw.tray.length !== 7) {
      this.lastError = 'dirty';
      this.clearGame();
      return null;
    }
    // holding 是 R-13 之后新增的字段：老存档没有它，按"暂存区为空"处理，
    // 不能因为少一个字段就把整局判成坏档（那会让玩家白玩一局）
    if (raw.holding !== undefined &&
        (!Array.isArray(raw.holding) || raw.holding.length > 3)) {
      this.lastError = 'dirty';
      this.clearGame();
      return null;
    }
    if (typeof raw.levelId !== 'string' || typeof raw.moves !== 'number' || typeof raw.elapsedMs !== 'number') {
      this.lastError = 'dirty';
      this.clearGame();
      return null;
    }
    var config = SM.levels.byId(raw.levelId);
    if (!config) {
      // 关卡被删了（比如以后只留两关）：这档无从恢复
      this.lastError = 'config';
      this.clearGame();
      return null;
    }
    if (raw.configHash !== schema.configHash(config)) {
      this.lastError = 'config';   // 关卡参数改过，旧局面已不合法
      this.clearGame();
      return null;
    }

    var badTile = raw.tiles.some(function (t) {
      return !schema.isPlainObject(t) || typeof t.id !== 'string' || typeof t.icon !== 'string' ||
        !schema.isNonNegativeInt(t.layer) || !Number.isInteger(t.col) || !Number.isInteger(t.row);
    });
    if (badTile) {
      this.lastError = 'dirty';
      this.clearGame();
      return null;
    }

    this.lastError = null;
    return raw;
  };

  Repository.prototype.clearGame = function () {
    this._db.remove(schema.KEYS.save);
  };

  /* -------------------------------------------------------------- 最佳记录 */

  Repository.prototype.loadBest = function () {
    var raw = this._db.read(schema.KEYS.best);
    if (!schema.isPlainObject(raw) || raw.v !== schema.VERSION || !schema.isPlainObject(raw.records)) {
      return schema.emptyBest();
    }
    var out = schema.emptyBest();
    Object.keys(out.records).forEach(function (levelId) {
      var list = raw.records[levelId];
      if (!Array.isArray(list)) return;
      out.records[levelId] = list.filter(function (r) {
        return schema.isPlainObject(r) && schema.isNonNegativeInt(r.timeMs) && schema.isNonNegativeInt(r.moves);
      }).sort(schema.compareRecord).slice(0, schema.MAX_RECORDS);
    });
    return out;
  };

  /** 某关的第一名（选关界面展示用），没有就返回 null。 */
  Repository.prototype.bestOf = function (levelId) {
    var list = this.loadBest().records[levelId] || [];
    return list.length ? list[0] : null;
  };

  /**
   * 提交成绩：入榜 → 排序 → 裁到 5 条；返回名次（0 表示新纪录）。
   * 并列时保留更早一条：这里用"严格更优才插到前面"的顺序插入来实现，
   * 所以完全相同的成绩会排在旧记录之后、被裁掉，等于保留先到的那条。
   */
  Repository.prototype.submitBest = function (levelId, result) {
    var data = this.loadBest();
    var list = data.records[levelId] || [];
    var record = {
      timeMs: result.timeMs,
      moves: result.moves,
      at: Date.now(),
      props: typeof result.props === 'number' ? result.props : 0
    };

    var idx = list.length;
    for (var i = 0; i < list.length; i++) {
      if (schema.compareRecord(record, list[i]) < 0) { idx = i; break; }
    }
    list.splice(idx, 0, record);
    var kept = list.slice(0, schema.MAX_RECORDS);
    data.records[levelId] = kept;
    data.v = schema.VERSION;
    this._db.write(schema.KEYS.best, data);

    var rank = kept.indexOf(record);
    return { isNew: rank === 0, rank: rank, kept: kept.length };
  };

  /* ---------------------------------------------------------------- 设置 */

  Repository.prototype.loadSettings = function () {
    return schema.normalizeSettings(this._db.read(schema.KEYS.settings));
  };

  Repository.prototype.saveSettings = function (settings) {
    var normalized = schema.normalizeSettings(settings);
    normalized.v = schema.VERSION;
    this._db.write(schema.KEYS.settings, normalized);
    return normalized;
  };

  /* ------------------------------------------------------------ 一把清空 */

  Repository.prototype.clearAll = function () {
    this._db.keys('nailegenai.').forEach(function (k) { this._db.remove(k); }, this);
  };

  SM.Repository = Repository;
})(window.SM = window.SM || {});
