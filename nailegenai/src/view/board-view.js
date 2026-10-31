/* ============================================================================
   board-view.js —— 表现层：牌堆视图（只读模型，绝不修改）
   这一层的纪律（DEP-3）：只允许读 Board 的数据，不允许写。
   所有位置都从模型取值——渲染层**不自己算坐标**，否则"判定用一套坐标、
   显示用另一套"，就会出现"看着能点、点了没反应"这类最难查的错位。

   节点复用：同一张牌始终复用同一个 DOM 节点（只在第一帧创建）。
   迭代 2 的入槽动画要靠"拿到这张牌的旧节点做 FLIP"，每帧重建节点会让动画永远起不来。
   ========================================================================= */
(function (SM) {
  'use strict';

  function BoardView(stageEl) {
    if (!stageEl) throw new Error('BoardView: 缺少舞台元素');
    this._stage = stageEl;
    this._nodes = new Map();     // id → DOM 节点
    this._iconSet = null;
    this._cells = { w: 0, h: 0 };  // 舞台半格尺寸（供 Renderer 算缩放）
  }

  BoardView.prototype.setIconSet = function (iconSet) {
    this._iconSet = iconSet;
    // 图标池换了，已建节点里的字形就过期了，整体重建一次（迭代 1 只会发生一次）
    this._nodes.forEach(function (node) { node.remove(); });
    this._nodes.clear();
  };

  /** 舞台的半格尺寸（渲染层据此设 --stage-w / --stage-h） */
  BoardView.prototype.cells = function () { return this._cells; };

  BoardView.prototype._createNode = function (tile) {
    var node = document.createElement('div');
    node.className = 'tile';
    node.dataset.id = tile.id;

    node.appendChild(SM.iconFace(this._iconSet, tile.icon));

    this._stage.appendChild(node);
    return node;
  };

  BoardView.prototype._apply = function (node, tile, covered) {
    // 位置：col/row 是半格坐标，CSS 里乘 --u；jitter 只加在视觉上，不写回模型
    node.style.setProperty('--col', tile.col);
    node.style.setProperty('--row', tile.row);
    node.style.setProperty('--jx', tile.jitterX);
    node.style.setProperty('--jy', tile.jitterY);

    // z-index：层号决定大序，行号在同层内做微调，保证绘制顺序稳定不闪
    node.style.zIndex = 100 + tile.layer * 10 + tile.row;

    SM.iconFace.update(node.firstChild, this._iconSet, tile.icon);

    node.classList.toggle('is-covered', covered);
    node.dataset.layer = tile.layer;
  };

  /**
   * 渲染整副牌堆。
   * 迭代 1 用"全量同步"：遍历模型、更新/创建节点、删掉多余的节点。
   * 全量的好处是"界面永远和模型一致"，代价是每次都遍历 144 个节点——
   * 对这个体量完全无所谓，比写增量刷新安全得多。
   */
  BoardView.prototype.render = function (board, config) {
    var seen = new Set();
    var self = this;

    board.all().forEach(function (tile) {
      var node = self._nodes.get(tile.id);
      if (!node) { node = self._createNode(tile); self._nodes.set(tile.id, node); }
      self._apply(node, tile, board.coverCountOf(tile.id) > 0);
      seen.add(tile.id);
    });

    // 模型里已经不存在的牌（消除、移出），把节点摘掉
    this._nodes.forEach(function (node, id) {
      if (!seen.has(id)) { node.remove(); self._nodes.delete(id); }
    });

    // 舞台尺寸：一局之内必须定死，不能跟着"当前还剩几张牌"变。
    // 曾经按 board.bounds() 算（以模型实际占用为准），后果是每消掉最右/最下一列，
    // 舞台盒子就缩一圈：.stage 由 flex 居中，盒子一缩，剩下的牌就整体往中间漂，
    // 同时 fit() 里 k = availW / w 会随之变大，牌又被放大 ——
    // 表现就是"玩到后面，牌自动挤到中间、还越玩越大"。
    // 现在取关卡配置的固定外框：宽高各 2*cols+2 / 2*rows+2 个半格
    // （2*cols+1 是"最后一列 + 一个格宽"的占用，再 +1 是 ±9px 抖动的活动余量）。
    // 层间错位不会越界：col 最大 = 2*(cols-1)+1，加牌宽 2 个半格刚好落在框内。
    if (config) {
      this._cells = { w: 2 * (config.gridCols || config.cols) + 2, h: 2 * (config.gridRows || config.rows) + 2 };
    } else {
      var b = board.bounds();
      this._cells = { w: b.w + 1, h: b.h + 1 };
    }
    this._stage.style.setProperty('--stage-w', this._cells.w);
    this._stage.style.setProperty('--stage-h', this._cells.h);
  };

  /** 取某张牌的节点（迭代 2 的 FLIP 动画要用起点矩形） */
  BoardView.prototype.nodeOf = function (tileId) { return this._nodes.get(tileId) || null; };

  SM.BoardView = BoardView;
})(window.SM = window.SM || {});
