/* ============================================================================
   levels.js —— 数据层：三关配置（纯数据，只读）
   迭代 1 只把这三关读出来并自校验，还不允许进入（选关界面是迭代 3 的事）。

   数字的来历（设计 §5.3 已验算，这里再核对一遍口径）：
     总张数 = layers × cols × rows
     每种图标张数 × 图标种类数 = 总张数
     每个数都必须是 3 的倍数（三张一组，否则最后一定剩 1～2 张消不掉）
   三关故意用"层数 / 格位数 / 图标种类"三个维度拉开差距，
   而不是单纯把牌堆做大 —— 层数决定遮挡深度，种类决定干扰，格位决定宽度。
   ========================================================================= */
(function (SM) {
  'use strict';

  var RAW = [
    {
      id: 'beginner',
      name: '入门',
      layers: 4, cols: 5, rows: 3,      // 60 张
      iconKinds: 10,
      perIconCount: 6,                  // 6 × 10 = 60（每种 6 张 = 2 组）
      props: { undo: 3, remove: 2, shuffle: 2 }
    },
    {
      id: 'advanced',
      name: '进阶',
      layers: 6, cols: 6, rows: 3,      // 108 张
      iconKinds: 12,
      perIconCount: 9,                  // 9 × 12 = 108（每种 9 张 = 3 组）
      props: { undo: 2, remove: 1, shuffle: 1 }
    },
    {
      id: 'challenge',
      name: '挑战',
      layers: 6, cols: 6, rows: 4,      // 144 张（9 层×4×4 会堆成一面墙，改成 6 层摊开）
      iconKinds: 16,
      perIconCount: 9,                  // 9 × 16 = 144（每种 9 张 = 3 组）
      props: { undo: 1, remove: 1, shuffle: 1 }
    }
  ];

  /** 全部关卡（LevelConfig 实例数组，冻结以防被下游改坏） */
  var levels = RAW.map(function (raw) { return new SM.LevelConfig(raw); });
  levels.forEach(function (lv) { Object.freeze(lv); });
  Object.freeze(levels);

  /** 按 id 取关卡；找不到返回 null（调用方自己决定是报错还是兜底） */
  function byId(id) {
    for (var i = 0; i < levels.length; i++) if (levels[i].id === id) return levels[i];
    return null;
  }

  SM.levels = {
    list: levels,
    byId: byId
  };
})(window.SM = window.SM || {});
