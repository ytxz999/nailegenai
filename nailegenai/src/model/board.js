/* ============================================================================
   board.js —— 模型层：牌堆（Board）
   这是全项目唯一"知道谁压着谁"的地方，也是覆盖判定的唯一权威（设计 §3.3）。

   三条设计约束，写在这里是为了后来改代码的人别踩：
   1) 存三份数据，各司其职：
        #tiles      主存储（id → Tile）
        #occupied   派生索引（"层:半格列:半格行" → Tile），只为加速"这个位置有没有牌"
        #coverCount 派生索引（id → 压住它的牌数），让 canPick 变成 O(1)
      派生索引**只在 add/remove 时增量维护**，绝不在每次点击时全量重算。
   2) 覆盖判定只用整数：overlaps = |Δcol| < 2 && |Δrow| < 2。
      一张牌占 2×2 个半格，所以差 0 完全重叠、差 1 错开半张仍压住、差 2 才真错开。
      这条式子与 DOM、缩放、devicePixelRatio 全部无关（BR-01）。
   3) 同层两张牌不允许重叠。允许的话"谁压谁"就没有意义了，
      覆盖计数会出现自相矛盾的加法/减法。

   注意：add() 会**双向**更新覆盖计数（既数"我压住了谁"，也数"谁压住了我"）。
   设计文档的表格是按"自下而上铺牌"写的，只提了单向；这里做成双向，
   是因为撤销与移出会在任意层序下把牌插回去，单向维护会漏数。
   ========================================================================= */
(function (SM) {
  'use strict';

  var CELL_W = 2;   // 一张牌占 2 个半格宽
  var CELL_H = 2;   // 一张牌占 2 个半格高

  function Board(cellSize) {
    if (cellSize !== undefined && cellSize !== 2) {
      // 保留参数位以对应设计签名，但目前只有"半格"一种口径，写死更安全
      throw new Error('Board: 目前只支持 cellSize = 2（半格单位）');
    }
    this._tiles = new Map();        // id → Tile
    this._occupied = new Map();     // "layer:col:row" → Tile
    this._coverCount = new Map();   // id → 覆盖它的牌数
    this._maxLayer = -1;
  }

  /* ---------------------------------------------------------------- 基础工具 */

  /** 两张牌是否重叠（整数比较，无浮点） */
  Board.overlaps = function (a, b) {
    return Math.abs(a.col - b.col) < CELL_W && Math.abs(a.row - b.row) < CELL_H;
  };

  /** 一张牌占据的 4 个半格格位键 */
  function cellKeys(tile) {
    var keys = [];
    for (var dx = 0; dx < CELL_W; dx++) {
      for (var dy = 0; dy < CELL_H; dy++) {
        keys.push(tile.layer + ':' + (tile.col + dx) + ':' + (tile.row + dy));
      }
    }
    return keys;
  }

  /* ---------------------------------------------------------------- 增删（唯一入口）

  add(tile) 与 remove(tile) 是**唯一**允许改动三份数据的地方。
  牌自己不能改坐标（Tile.moveTo 会检查是否被 Board 接管），
  外面也不能直接 push —— 只要守住这两个入口，两个索引就不会漂。 */

  Board.prototype.add = function (tile) {
    if (!(tile instanceof SM.Tile)) throw new Error('Board.add: 只接受 Tile');
    if (this._tiles.has(tile.id)) throw new Error('Board.add: 重复的牌 id ' + tile.id);

    var keys = cellKeys(tile);
    for (var i = 0; i < keys.length; i++) {
      if (this._occupied.has(keys[i])) {
        throw new Error('Board.add: 格位被占用 ' + keys[i] + '（同层不允许重叠）');
      }
    }

    tile.attachTo(this);
    tile.setState('board');
    this._tiles.set(tile.id, tile);
    for (i = 0; i < keys.length; i++) this._occupied.set(keys[i], tile);
    this._coverCount.set(tile.id, 0);

    // 双向更新覆盖关系：与已有牌逐对比较
    // 语义只有一句：_coverCount[X] = "压在我上面的牌有几张"。
    // 所以"谁在上面"决定"给谁加计数"——上面那张不会被下面这张压住，
    // 千万别写成"给上层加"，那是把覆盖方向搞反了（迭代 1 自测时真踩过这个坑：
    // 表现为最顶层的牌全被压暗、最底层的牌反而显示可点）。
    var self = this;
    this._tiles.forEach(function (other) {
      if (other === tile) return;
      if (!SM.Board.overlaps(other, tile)) return;
      if (other.layer > tile.layer) self._bump(tile.id, +1);   // 已有的牌在上面 → 压住新牌
      else if (other.layer < tile.layer) self._bump(other.id, +1); // 已有的牌在下面 → 被新牌压住
    });

    if (tile.layer > this._maxLayer) this._maxLayer = tile.layer;
  };

  Board.prototype.remove = function (tile) {
    if (!(tile instanceof SM.Tile)) throw new Error('Board.remove: 只接受 Tile');
    if (!this._tiles.has(tile.id)) throw new Error('Board.remove: 牌不在牌堆中 ' + tile.id);

    var keys = cellKeys(tile);
    for (var i = 0; i < keys.length; i++) this._occupied.delete(keys[i]);

    var self = this;
    this._tiles.forEach(function (other) {
      if (other === tile) return;
      if (!SM.Board.overlaps(other, tile)) return;
      // 只减"原本被我压住"的那些（在我下面、且与我重叠）
      if (other.layer < tile.layer) self._bump(other.id, -1);
    });

    this._tiles.delete(tile.id);
    this._coverCount.delete(tile.id);
    tile.detach(this);

    if (tile.layer === this._maxLayer) this._maxLayer = this._recomputeMaxLayer();
  };

  /** 覆盖计数增减，顺带把"减到负数"这种漂移当场抓出来 */
  Board.prototype._bump = function (tileId, delta) {
    var n = (this._coverCount.get(tileId) || 0) + delta;
    if (n < 0) throw new Error('Board: 覆盖计数为负 ' + tileId + '，索引已漂移');
    this._coverCount.set(tileId, n);
  };

  Board.prototype._recomputeMaxLayer = function () {
    var max = -1;
    this._tiles.forEach(function (t) { if (t.layer > max) max = t.layer; });
    return max;
  };

  Board.prototype.clear = function () {
    var self = this;
    this._tiles.forEach(function (t) { t.detach(self); });
    this._tiles.clear();
    this._occupied.clear();
    this._coverCount.clear();
    this._maxLayer = -1;
  };

  /* ---------------------------------------------------------------- 查询 */

  /** O(1)：不在牌堆、或被任何牌压住，都不能点 */
  Board.prototype.canPick = function (tileId) {
    var t = this._tiles.get(tileId);
    if (!t || t.state !== 'board') return false;
    return (this._coverCount.get(tileId) || 0) === 0;
  };

  Board.prototype.coverCountOf = function (tileId) {
    return this._coverCount.get(tileId) || 0;
  };

  Board.prototype.get = function (tileId) { return this._tiles.get(tileId); };
  Board.prototype.has = function (tileId) { return this._tiles.has(tileId); };
  Board.prototype.size = function () { return this._tiles.size; };
  Board.prototype.maxLayer = function () { return this._maxLayer; };

  /** 返回副本数组，防止外部拿到内部集合后随手改 */
  Board.prototype.all = function () {
    var arr = [];
    this._tiles.forEach(function (t) { arr.push(t); });
    return arr;
  };

  /** 当前所有"可点的牌"的 id —— 控制台排查"无牌可点"时最有用的一件事 */
  Board.prototype.pickableIds = function () {
    var self = this;
    return this.all().filter(function (t) { return self.canPick(t.id); }).map(function (t) { return t.id; });
  };

  /** 牌堆实际占用的半格边界，渲染层据此算舞台尺寸（而不是信配置） */
  Board.prototype.bounds = function () {
    var maxCol = -1, maxRow = -1;
    this._tiles.forEach(function (t) {
      if (t.col + CELL_W > maxCol) maxCol = t.col + CELL_W;
      if (t.row + CELL_H > maxRow) maxRow = t.row + CELL_H;
    });
    return { w: Math.max(maxCol, 0), h: Math.max(maxRow, 0) };
  };

  /** 调试用：总张数与每层张数（验收要求控制台能打印） */
  Board.prototype.debugCount = function () {
    var perLayer = [];
    var perIcon = {};
    this._tiles.forEach(function (t) {
      perLayer[t.layer] = (perLayer[t.layer] || 0) + 1;
      perIcon[t.icon] = (perIcon[t.icon] || 0) + 1;
    });
    for (var i = 0; i < perLayer.length; i++) if (!perLayer[i]) perLayer[i] = 0;
    return { total: this._tiles.size, perLayer: perLayer, perIcon: perIcon };
  };

  /* ---------------------------------------------------------------- 索引重建与自检 */

  /**
   * 丢弃两个派生索引并按主存储全量重建。
   * 只在两个场合调用：读档恢复、断言失败。
   * 平时绝不能调 —— 全量重建是 O(n²)，而且会掩盖"增量维护漏了"的 bug。
   */
  Board.prototype.rebuildIndexes = function () {
    var tiles = this.all().sort(function (a, b) { return a.layer - b.layer; });
    var self = this;
    this._occupied.clear();
    this._coverCount.clear();
    tiles.forEach(function (t) { self._coverCount.set(t.id, 0); });
    tiles.forEach(function (t) {
      for (var i = 0; i < CELL_W; i++) {
        for (var j = 0; j < CELL_H; j++) {
          self._occupied.set(t.layer + ':' + (t.col + i) + ':' + (t.row + j), t);
        }
      }
    });
    tiles.forEach(function (a) {
      tiles.forEach(function (b) {
        if (a === b || b.layer <= a.layer) return;   // b 必须在 a 上面才算压住
        if (SM.Board.overlaps(a, b)) self._bump(a.id, +1);  // 计数记给下面那张 a
      });
    });
    this._maxLayer = this._recomputeMaxLayer();
  };

  /**
   * 不变式自检，返回可读报告（不是裸 throw）。
   * 为什么返回报告：验收时我要能一眼看出"哪条不成立、期望多少、实际多少"；
   * 抛异常只知道"坏了"，不知道"坏在哪一步"。
   *
   * @param {Object} [extraPerIcon] 牌堆之外还要计入的图标张数（槽位里的牌）。
   *   I-4 的语义是**整关**每种图标张数必须是 3 的倍数（BR-04）；
   *   只拿牌堆统计会在"牌在槽里"时误报（迭代 4 自测时真踩到：
   *   移出再撤销后有一张牌留在槽位，牌堆里 gou 剩 11 张，被判成破坏不变量）。
   */
  Board.prototype.assertInvariants = function (extraPerIcon) {
    var self = this;
    var checks = [];
    var tiles = this.all();

    // I-1 占用索引与主存储一致
    (function () {
      var bad = [];
      self._occupied.forEach(function (t, key) {
        if (!self._tiles.has(t.id)) bad.push('索引指向已移除的牌 ' + key);
        var parts = key.split(':');
        var l = +parts[0], c = +parts[1], r = +parts[2];
        if (t.layer !== l || c < t.col || c > t.col + 1 || r < t.row || r > t.row + 1) {
          bad.push('索引键与牌坐标不符 ' + key + ' → ' + t.id);
        }
      });
      tiles.forEach(function (t) {
        for (var i = 0; i < CELL_W; i++) {
          for (var j = 0; j < CELL_H; j++) {
            var k = t.layer + ':' + (t.col + i) + ':' + (t.row + j);
            if (self._occupied.get(k) !== t) bad.push('格位缺失 ' + k + '（' + t.id + '）');
          }
        }
      });
      checks.push({ id: 'I-1', name: '占用索引 ⟺ 牌堆成员', ok: bad.length === 0, detail: bad.join('; ') });
    })();

    // I-2 覆盖计数与逐对重算结果一致（直接对着"缓存漂移"这个最难的 bug）
    (function () {
      var expect = new Map();
      tiles.forEach(function (t) { expect.set(t.id, 0); });
      tiles.forEach(function (a) {
        tiles.forEach(function (b) {
          if (a === b || b.layer <= a.layer) return;   // 只统计"上方压住我"的牌
          if (SM.Board.overlaps(a, b)) expect.set(a.id, expect.get(a.id) + 1);
        });
      });
      var bad = [];
      expect.forEach(function (n, id) {
        var got = self._coverCount.get(id) || 0;
        if (got !== n) bad.push(id + ' 期望 ' + n + ' 实际 ' + got);
      });
      checks.push({ id: 'I-2', name: '覆盖计数与重算一致', ok: bad.length === 0, detail: bad.join('; ') });
    })();

    // I-3 同层不重叠
    (function () {
      var bad = [];
      for (var i = 0; i < tiles.length; i++) {
        for (var j = i + 1; j < tiles.length; j++) {
          if (tiles[i].layer !== tiles[j].layer) continue;
          if (SM.Board.overlaps(tiles[i], tiles[j])) {
            bad.push(tiles[i].id + ' 与 ' + tiles[j].id + ' 同层重叠');
          }
        }
      }
      checks.push({ id: 'I-3', name: '同层互不重叠', ok: bad.length === 0, detail: bad.join('; ') });
    })();

    // I-4 数量不变量：每种图标张数必须是 3 的倍数（BR-04）
    (function () {
      var perIcon = Object.assign({}, self.debugCount().perIcon);
      if (extraPerIcon) {
        Object.keys(extraPerIcon).forEach(function (k) {
          perIcon[k] = (perIcon[k] || 0) + extraPerIcon[k];
        });
      }
      var bad = [];
      Object.keys(perIcon).forEach(function (k) {
        if (perIcon[k] % 3 !== 0) bad.push(k + ' = ' + perIcon[k] + ' 张，不是 3 的倍数');
      });
      checks.push({ id: 'I-4', name: '每种图标张数 % 3 === 0（含槽位）', ok: bad.length === 0, detail: bad.join('; ') });
    })();

    // I-5 牌堆内的牌状态必须都是 board
    (function () {
      var bad = tiles.filter(function (t) { return t.state !== 'board'; })
                     .map(function (t) { return t.id + '=' + t.state; });
      checks.push({ id: 'I-5', name: '牌堆内牌状态均为 board', ok: bad.length === 0, detail: bad.join('; ') });
    })();

    var ok = checks.every(function (c) { return c.ok; });
    return { ok: ok, total: tiles.length, checks: checks };
  };

  SM.Board = Board;
})(window.SM = window.SM || {});
