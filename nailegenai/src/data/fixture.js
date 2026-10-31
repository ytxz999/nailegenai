/* ============================================================================
   fixture.js —— 数据层（临时）：迭代 1 的样例牌堆
   为什么迭代 1 不用生成器：
     这一轮要验证的是"模型与坐标系能不能撑住渲染"，不是"生成算法对不对"。
     用固定数据，几何一旦算错能立刻定位到 Board/坐标，而不是先怀疑随机数。
     迭代 3 会把这个文件删掉，改由 src/engine/level-generator.js 产出（P05 迭代 3 的交付清单里已列删除）。

   铺牌规则（与设计 §3.5 的层错位一致）：
     第 l 层第 c 列 = 半格列 2c + (l % 2)，第 r 行 = 半格行 2r + (l % 2)。
     加 1 个半格就是"错开半张牌"，于是每张牌会压住下一层的两张（不压四张）——
     这正是这类堆叠消除游戏的观感来源，也让 overlaps 的 |Δ|<2 判据有实际意义。

   图标分配（先按"三张一组"分好，再落到位置上）：
     总张数 = 3 × 组数，第 g 组用第 (g % 种类数) 种图标，
     所以每种图标恰好占 (组数 / 种类数) 组。这条等分能成立，
     靠的是配置里"每种图标张数 × 种类数 = 总张数"且两者都是 3 的倍数（LevelConfig.validate 保证）。
   ========================================================================= */
(function (SM) {
  'use strict';

  /** 迭代 1 的样例关卡：3 层 × 5 列 × 3 行 = 45 张，5 种图标各 9 张 */
  var DEMO_RAW = {
    id: 'demo',
    name: '样例牌堆',
    layers: 3, cols: 5, rows: 3,
    iconKinds: 5,
    perIconCount: 9,                   // 9 × 5 = 45
    props: { undo: 0, remove: 0, shuffle: 0 }
  };

  var demoConfig = new SM.LevelConfig(DEMO_RAW);

  /**
   * 生成样例牌堆的 Tile 数组。
   * 返回的是"未加入 Board 的裸牌"，由 Game.startLevel 负责 Board.add —— 
   * 这样 fixture 不需要知道 Board 的存在，测试时也能单独拿到这堆牌做几何校验。
   */
  function build(config, iconSet) {
    var total = config.tileCount;
    if (total % 3 !== 0) throw new Error('fixture: 总张数不是 3 的倍数 ' + total);

    var keys = iconSet.keys();
    var perLayer = config.cols * config.rows;
    var tiles = [];
    var group = 0;
    var inGroup = 0;
    var icon = keys[0];

    for (var i = 0; i < total; i++) {
      // 每 3 张换一组；组号决定图标，组内 3 张图标相同
      if (inGroup === 0) {
        icon = keys[group % keys.length];
      }

      var layer = Math.floor(i / perLayer);
      var rest = i % perLayer;
      var row = Math.floor(rest / config.cols);
      var col = rest % config.cols;

      var tile = new SM.Tile(
        't' + (i < 10 ? '00' : i < 100 ? '0' : '') + i,
        icon,
        layer,
        2 * col + (layer % 2),
        2 * row + (layer % 2),
        group
      );
      tiles.push(tile);

      inGroup++;
      if (inGroup === 3) { inGroup = 0; group++; }
    }

    // 出牌后立刻对账：每种图标张数必须等于配置声明（不符合说明等分逻辑错了）
    var counts = {};
    tiles.forEach(function (t) { counts[t.icon] = (counts[t.icon] || 0) + 1; });
    keys.forEach(function (k) {
      if (counts[k] !== config.perIconCount) {
        throw new Error('fixture: 图标 ' + k + ' 实际 ' + (counts[k] || 0) +
                        ' 张，与配置声明的 ' + config.perIconCount + ' 张不符');
      }
    });

    return tiles;
  }

  SM.fixture = {
    demoConfig: demoConfig,
    build: build
  };
})(window.SM = window.SM || {});
