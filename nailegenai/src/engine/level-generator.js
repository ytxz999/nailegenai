/* ============================================================================
   level-generator.js —— 引擎层：牌堆生成器（保证有解）
   ---------------------------------------------------------------------------
   问题：随便撒牌 + 随机图标，很容易生成"死局"——剩下的牌互相压住，
        或者同图标的三张分别压在三处、槽位 7 格放不下，玩家再聪明也过不去。

   本项目的做法是**反着铺**：先算出一个"合法的拆除顺序"，再沿着这个顺序
   把牌按三张一组发下去。这样只要玩家照着这个顺序拆，就一定通关，
   于是"存在一条通关路径"是被构造出来的，而不是靠概率碰运气。

   一、先算拆除顺序（与图标无关，只看几何遮挡）
       1. 生成所有格位：layer ∈ [0, layers)，col = 2c + layer%2，row = 2r + layer%2。
          层间错开半格（+layer%2）是 BR-01 覆盖判定的前提，也是"看得见压住谁"的关键。
       2. 对每个格位算出"压在它上面的格位"集合（层号更大且半格距离 < 2）。
       3. 反复做：在当前还没被拆走的格位里，挑出"上方一张都没剩"的那些，
          随机取一个拆走，记进拆除序列。取不到就说明遮挡关系里有环（几何写错了）。
       —— 这一步输出的序列有一个关键性质：
          **序列里每个格位在它被拆的时刻，上面确实是空的**，
          也就是"这个顺序在游戏里真的点得动"。

   二、再发图标（沿拆除序列，每三张一组）
       把序列切成 [0,1,2] [3,4,5] … 每组发同一个图标，组与组之间按图标池轮转。
       于是沿着序列点下去，槽位里最多同时存在 3 张（凑齐就消），永远不会溢出。
       组编号顺带写进 Tile.group，迭代 4 的洗牌要按"整组置换"才能保住可解性。

   三、发完自检（生成即验证，不通过就重来）
       每次生成后跑三条断言：
         ① 每种图标的张数 === perIconCount，且 %3 === 0
         ② 每个 group 恰好 3 张，且三张图标相同
         ③ 照拆除序列模拟一遍：槽位峰值 ≤ 3，最终能全部消完
       任一条不过就换一个随机种子重生成（最多 20 次）；
       20 次都不过则抛错——那说明是算法或配置的问题，不该让玩家去承担。
   ========================================================================= */
(function (SM) {
  'use strict';

  var MAX_ATTEMPTS = 20;

  /* ------------------------------------------------------------ 几何小工具 */

  function key(p) { return p.layer + ':' + p.col + ':' + p.row; }

  function overlaps(a, b) {
    return Math.abs(a.col - b.col) < 2 && Math.abs(a.row - b.row) < 2;
  }

  /* ------------------------------------------------------------ 位置铺设 */

  /** Fisher–Yates：只用于"从候选格位里随机取"，不改模型（R-18b） */
  function shuffleInPlace(list, rand) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  /**
   * 所有格位（R-18b：**不铺满**，在放大的候选栅格里带权随机取）
   *
   * 旧实现是"每层把 cols×rows 铺满"，外轮廓天然是一张齐整的网——
   * 这正是"牌堆看着像一整块、全挤在中间"的根。
   * 现在每层仍然要放 cols×rows 张（总数不变，配置与存档指纹都不动），
   * 但候选栅格是 gridCols×gridRows（≈1.35 倍边长），随机取位置后填充率约五成：
   *   · 边缘是毛的，不再是矩形；
   *   · 层与层之间的位置互不对齐，纵深靠"错位"而不是靠"叠厚"；
   *   · 越上层的牌越往中间挑（taper 权重），于是底宽上窄，像个塔。
   * 同层仍保证不重叠：格位坐标都是 2c / 2r（偶数），不同 c 的 |Δcol| ≥ 2。
   */
  function buildPositions(config, rand) {
    rand = rand || Math.random;
    var perLayer = config.cols * config.rows;          // 每层张数（= 总张数 / 层数）
    var gridCols = config.gridCols || config.cols;
    var gridRows = config.gridRows || config.rows;
    var layers = config.layers;
    var list = [];

    // 中心与最大半径，用于"越上层越往中间收"的权重
    var cx = (gridCols - 1) / 2;
    var cy = (gridRows - 1) / 2;
    var maxR = Math.sqrt(cx * cx + cy * cy) || 1;

    for (var layer = 0; layer < layers; layer++) {
      var shift = layer % 2;   // 奇数层右下挪半格：正对堆叠会把下层完全盖死，错半格才露出边
      // 0 = 底层（哪儿都能放），1 = 顶层（只往中间放）——等价于 yulegeyu 的 borderStep
      var taper = layers <= 1 ? 0 : layer / (layers - 1);

      var cells = [];
      for (var c = 0; c < gridCols; c++) {
        for (var r = 0; r < gridRows; r++) cells.push([c, r]);
      }
      if (cells.length < perLayer) {
        throw new Error('LevelGenerator: 第 ' + layer + ' 层只有 ' + cells.length +
          ' 个候选格位，放不下 ' + perLayer + ' 张（栅格 = ' + gridCols + '×' + gridRows + '）');
      }

      // 带权随机取样：靠边的格位在高层被选中的概率低（拒绝采样，不重排原数组）
      var taken = Object.create(null);
      var picked = 0;
      var tries = 0;
      var limit = perLayer * 80;
      while (picked < perLayer && tries < limit) {
        tries += 1;
        var cell = cells[Math.floor(rand() * cells.length)];
        var ck = cell[0] + ':' + cell[1];
        if (taken[ck]) continue;
        var dx = cell[0] - cx, dy = cell[1] - cy;
        var dist = Math.sqrt(dx * dx + dy * dy) / maxR;
        if (rand() > 1 - taper * 0.85 * dist) continue;   // 上层：越靠边越可能被拒
        taken[ck] = true;
        picked += 1;
        list.push({ layer: layer, col: 2 * cell[0] + shift, row: 2 * cell[1] + shift });
      }
      // 兜底：拒绝采样没凑够（极端配置下才会发生），剩下的用均匀抽样补齐
      if (picked < perLayer) {
        shuffleInPlace(cells, rand);
        for (var i = 0; i < cells.length && picked < perLayer; i++) {
          var ck2 = cells[i][0] + ':' + cells[i][1];
          if (taken[ck2]) continue;
          taken[ck2] = true;
          picked += 1;
          list.push({ layer: layer, col: 2 * cells[i][0] + shift, row: 2 * cells[i][1] + shift });
        }
      }
    }
    return list;
  }

  /** 每个格位"压在它上面的格位"列表 */
  function buildCovers(positions) {
    var covers = Object.create(null);
    var i, j;
    for (i = 0; i < positions.length; i++) covers[key(positions[i])] = [];
    for (i = 0; i < positions.length; i++) {
      for (j = 0; j < positions.length; j++) {
        var a = positions[i], b = positions[j];
        // b 在 a 上面且与 a 相交 → b 压住 a
        if (b.layer > a.layer && overlaps(a, b)) covers[key(a)].push(key(b));
      }
    }
    return covers;
  }

  /**
   * 拆除序列：每次只从"上方已清空"的格位里随机取一个。
   * 用 Set 记录还活着的格位，covers 里的键逐个比对——144 张牌规模下完全够用，
   * 换成位图只是为了省几十毫秒，不值得把代码写复杂。
   */
  function peelOrder(positions, covers, rand) {
    var alive = Object.create(null);
    var i;
    for (i = 0; i < positions.length; i++) alive[key(positions[i])] = true;

    var order = [];
    while (order.length < positions.length) {
      var free = [];
      for (i = 0; i < positions.length; i++) {
        var p = positions[i];
        var k = key(p);
        if (!alive[k]) continue;
        var blocked = false;
        var ups = covers[k];
        for (var j = 0; j < ups.length; j++) {
          if (alive[ups[j]]) { blocked = true; break; }
        }
        if (!blocked) free.push(p);
      }
      if (!free.length) {
        throw new Error('LevelGenerator: 遮挡关系成环，无牌可拆（几何配置有误）');
      }
      var pick = free[Math.floor(rand() * free.length)];
      order.push(pick);
      alive[key(pick)] = false;
    }
    return order;
  }

  /* ------------------------------------------------------------ 自检三断言 */

  /**
   * 生成后的自检。返回 { ok, errors: [] }。
   * 三条断言就是函数头注释里写的 ①②③，checkSolvable 单独导出给控制台调用。
   */
  function selfCheck(tiles, config) {
    var errors = [];

    // ① 每种图标张数
    var perIcon = Object.create(null);
    tiles.forEach(function (t) { perIcon[t.icon] = (perIcon[t.icon] || 0) + 1; });
    Object.keys(perIcon).forEach(function (icon) {
      var n = perIcon[icon];
      if (n % 3 !== 0) errors.push('图标 ' + icon + ' 有 ' + n + ' 张，不是 3 的倍数');
      if (n !== config.perIconCount) {
        errors.push('图标 ' + icon + ' 有 ' + n + ' 张，配置要求 ' + config.perIconCount + ' 张');
      }
    });
    if (Object.keys(perIcon).length !== config.iconKinds) {
      errors.push('实际用到 ' + Object.keys(perIcon).length + ' 种图标，配置要求 ' + config.iconKinds + ' 种');
    }
    if (tiles.length % 3 !== 0) errors.push('总张数 ' + tiles.length + ' 不是 3 的倍数');

    // ② 每个 group 恰好 3 张同图标
    var groups = Object.create(null);
    tiles.forEach(function (t) {
      groups[t.group] = groups[t.group] || [];
      groups[t.group].push(t);
    });
    Object.keys(groups).forEach(function (g) {
      var arr = groups[g];
      if (arr.length !== 3) errors.push('第 ' + g + ' 组有 ' + arr.length + ' 张，应为 3 张');
      if (arr.length === 3 && !(arr[0].icon === arr[1].icon && arr[1].icon === arr[2].icon)) {
        errors.push('第 ' + g + ' 组的三张图标不一致');
      }
    });
    if (Object.keys(groups).length !== config.groupCount()) {
      errors.push('共 ' + Object.keys(groups).length + ' 组，配置要求 ' + config.groupCount() + ' 组');
    }

    return { ok: errors.length === 0, errors: errors, perIcon: perIcon };
  }

  /**
   * 按给定顺序模拟"一路点下去"，检查槽位是否溢出。
   * 这是"有解"的可执行证据：只要这条路径不溢出、且能把牌清完，玩家就至少存在一条活路。
   */
  function checkSolvable(tiles, order) {
    var byKey = Object.create(null);
    tiles.forEach(function (t) {
      byKey[t.layer + ':' + t.col + ':' + t.row] = t;
    });
    var tray = [];
    var peak = 0;
    for (var i = 0; i < order.length; i++) {
      var p = order[i];
      var t = byKey[key(p)];
      if (!t) return { ok: false, reason: '拆除序列里的格位没有牌：' + key(p) };
      tray.push(t);
      peak = Math.max(peak, tray.length);
      // 三消：本项目不做连锁，只看这一个图标
      var same = tray.filter(function (x) { return x.icon === t.icon; });
      if (same.length === 3) {
        tray = tray.filter(function (x) { return x.icon !== t.icon; });
      }
      if (tray.length > 7) {
        return { ok: false, reason: '第 ' + (i + 1) + ' 步槽位溢出（' + tray.length + ' 张）' };
      }
    }
    return { ok: tray.length === 0, peak: peak, remaining: tray.length };
  }

  /* ---------------------------------------------------------------- 主流程 */

  /**
   * @param {SM.LevelConfig} config
   * @param {SM.IconSet} iconSet   图标池（取前 config.iconKinds 个）
   * @param {Object} [opts]        { rand: () => [0,1) }
   * @returns {SM.Tile[]}
   */
  function buildDetailed(config, iconSet, opts) {
    opts = opts || {};
    var rand = opts.rand || Math.random;
    var keys = iconSet.keys().slice(0, config.iconKinds);
    if (keys.length !== config.iconKinds) {
      throw new Error('LevelGenerator: 图标池只有 ' + keys.length + ' 种，关卡要求 ' + config.iconKinds + ' 种');
    }

    var positions = buildPositions(config, rand);
    if (positions.length !== config.tileCount) {
      throw new Error('LevelGenerator: 格位 ' + positions.length + ' 个，与总张数 ' + config.tileCount + ' 不符');
    }
    var covers = buildCovers(positions);

    var lastErrors = [];
    for (var attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      var order = peelOrder(positions, covers, rand);

      // 沿拆除序列切三张一组，组间轮转图标
      var tiles = [];
      for (var i = 0; i < order.length; i++) {
        var p = order[i];
        var g = Math.floor(i / 3);
        tiles.push(new SM.Tile(
          't' + (i < 10 ? '00' : i < 100 ? '0' : '') + i,
          keys[g % keys.length],
          p.layer, p.col, p.row,
          g
        ));
      }

      var check = selfCheck(tiles, config);
      var solvable = check.ok ? checkSolvable(tiles, order) : { ok: false, reason: '自检未通过' };
      if (check.ok && solvable.ok) {
        // 自检通过：把证据留在对象上，控制台与报告截图都能直接引用
        return {
          tiles: tiles,
          order: order,
          checks: {
            attempts: attempt + 1,
            perIcon: check.perIcon,
            groups: config.groupCount(),
            trayPeak: solvable.peak,
            solvable: true
          }
        };
      }
      lastErrors = check.errors.concat(solvable.ok ? [] : [solvable.reason]);
    }

    throw new Error('LevelGenerator: 连续 ' + MAX_ATTEMPTS + ' 次生成都未通过自检 → ' + lastErrors.join('；'));
  }

  /** 与 fixture.build 同签名，方便 Game 直接使用 */
  function build(config, iconSet, opts) {
    return buildDetailed(config, iconSet, opts).tiles;
  }

  SM.levelGenerator = {
    build: build,
    buildDetailed: buildDetailed,
    // 下面三个导出给"控制台手工验证"与迭代 6 的求解器页复用
    buildPositions: buildPositions,
    checkSolvable: checkSolvable,
    selfCheck: selfCheck
  };
})(window.SM = window.SM || {});
