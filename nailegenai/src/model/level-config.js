/* ============================================================================
   level-config.js —— 模型层：关卡配置（LevelConfig，不可变值对象）
   职责：
     · 描述一关"有多大、几种图标、道具几次"，是**纯数据**，不含任何布局算法；
     · 自校验：把"改难度时把 108 写成 104"这类笔误挡在启动阶段，
       而不是等到玩家点到一半发现牌数凑不成三张（BR-04 数量不变量）。
   为什么校验放在配置里而不是生成器里：
     配置是"人写的数字"，错一定出在写数字这一步；让配置自己证明自己合法，
     生成器就只需要相信输入，不必到处写防御代码。
   ========================================================================= */
(function (SM) {
  'use strict';

  function LevelConfig(raw) {
    raw = raw || {};
    this.id = raw.id;
    this.name = raw.name;
    this.layers = raw.layers;
    this.cols = raw.cols;          // 每层格位列数（不是半格数）
    this.rows = raw.rows;
    this.iconKinds = raw.iconKinds;
    this.perIconCount = raw.perIconCount;
    this.props = raw.props || { undo: 0, remove: 0, shuffle: 0 };
    // 撤销栈上限也归配置（设计 §5.2 给的是 30）：它是"一关允许后悔多少步"的一部分，
    // 散在引擎里写死会让"挑战关只留 10 步"这类调整变成改代码。
    // 默认值单点定义在 LevelConfig.DEFAULT_UNDO_LIMIT，UndoManager 也从这里取（P07 走查 S-5），
    // 否则"30"会在两个文件里各写一遍，迟早对不上。
    this.undoStackLimit = (raw.undoStackLimit === undefined)
      ? LevelConfig.DEFAULT_UNDO_LIMIT
      : raw.undoStackLimit;

    // 总张数不入参：由 layers × cols × rows 推导，避免"手填总数与层行列对不上"
    this.tileCount = this.layers * this.cols * this.rows;

    // 候选栅格（R-18b）：每层的牌不再铺满 cols×rows，而是在一块**更大**的栅格里
    // 随机选位置（借 yulegeyu 的 levelBlockNum 思路：块数是固定目标，位置随机）。
    // 张数仍等于 layers × cols × rows，所以配置、存档指纹、校验全都不变，
    // 变的只是"这 N 块摆在哪"——栅格放大 GRID_WIDEN 倍后填充率约五成，
    // 边缘必然是毛的，而不是一张齐整的网。
    this.gridCols = Math.max(this.cols, Math.round(this.cols * LevelConfig.GRID_WIDEN));
    this.gridRows = Math.max(this.rows, Math.round(this.rows * LevelConfig.GRID_WIDEN));
  }

  /**
   * 自校验，返回错误说明数组（空数组 = 通过）。
   * 五条判据与设计 §3.2 一致：
   *   ① 总张数是 3 的倍数（否则必然剩 1～2 张消不掉）
   *   ② 每种图标张数是 3 的倍数（同上，且是"三张一组"的前提）
   *   ③ 每种图标张数 × 种类数 = 总张数（不能多也不能少）
   *   ④ 层 × 行 × 列 = 总张数（与 ③ 一起把四个数字锁死）
   *   ⑤ 道具次数非负
   */
  LevelConfig.prototype.validate = function () {
    var errs = [];
    var need = ['id', 'name', 'layers', 'cols', 'rows', 'iconKinds', 'perIconCount'];
    for (var i = 0; i < need.length; i++) {
      var v = this[need[i]];
      if (v === undefined || v === null || v === '') errs.push('缺少字段 ' + need[i]);
    }
    if (errs.length) return errs;

    if (!Number.isInteger(this.layers) || this.layers < 1) errs.push('layers 必须是正整数');
    if (!Number.isInteger(this.cols) || this.cols < 1) errs.push('cols 必须是正整数');
    if (!Number.isInteger(this.rows) || this.rows < 1) errs.push('rows 必须是正整数');
    if (errs.length) return errs;

    if (this.tileCount % 3 !== 0) {
      errs.push('总张数 ' + this.tileCount + ' 不是 3 的倍数');
    }
    if (this.perIconCount % 3 !== 0) {
      errs.push('每种图标张数 ' + this.perIconCount + ' 不是 3 的倍数');
    }
    if (this.perIconCount * this.iconKinds !== this.tileCount) {
      errs.push('每种 ' + this.perIconCount + ' 张 × ' + this.iconKinds +
                ' 种 = ' + (this.perIconCount * this.iconKinds) + '，与总张数 ' + this.tileCount + ' 不一致');
    }
    var p = this.props;
    ['undo', 'remove', 'shuffle'].forEach(function (k) {
      if (!Number.isInteger(p[k]) || p[k] < 0) errs.push('道具 ' + k + ' 的次数必须是非负整数');
    });
    if (!Number.isInteger(this.undoStackLimit) || this.undoStackLimit < 1) {
      errs.push('undoStackLimit 必须是正整数');
    }
    return errs;
  };

  /** 三张一组，共几组（= 总张数 / 3） */
  LevelConfig.prototype.groupCount = function () {
    return this.tileCount / 3;
  };

  /**
   * 舞台的半格尺寸。
   * 层内格位从 0 起，最右一列的左边界是 2*(cols-1)，再算上一张牌宽 2 个半格，
   * 末尾 +1 是层间半格错位需要的余量（设计 §3.5）。
   * 用半格而不是 px 表达，是为了让"舞台多大"与"屏幕多大"彻底无关。
   */
  LevelConfig.prototype.stageSize = function () {
    return {
      w: 2 * (this.gridCols || this.cols) + 1,
      h: 2 * (this.gridRows || this.rows) + 1
    };
  };

  /* --------------------------------------------------- 布局常量（R-18b 引入） */

  /**
   * 候选栅格放大倍数：1.35 时栅格面积是"铺满所需"的 1.8 倍，
   * 每层填充率 ≈ 55%，边缘自然毛糙（对照 yulegeyu 的 levelBlockNum=24 配 8×8 板）。
   * 试过 1.5：牌散得太开、堆叠感弱；1.2：又糊成一片。
   */
  LevelConfig.GRID_WIDEN = 1.35;

  /**
   * 撤销栈的默认上限（P07 走查 S-5）。
   * 放在这里而不是 UndoManager 里：它属于"一关允许后悔多少步"，
   * 是关卡配置的一部分；UndoManager 只是执行者，缺省时到这里取。
   */
  LevelConfig.DEFAULT_UNDO_LIMIT = 30;

  SM.LevelConfig = LevelConfig;
})(window.SM = window.SM || {});
