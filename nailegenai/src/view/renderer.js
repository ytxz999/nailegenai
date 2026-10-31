/* ============================================================================
   renderer.js —— 表现层：渲染总调度
   职责：把模型的数字写进 DOM、算一次缩放比例、播三种动画（入槽飞行 / 三消消失 / 无效点击抖动）。
   它**不认识** Game 的任何规则，只调 game 的只读属性与方法（DEP-3）。

   缩放策略：舞台用半格单位定死像素尺寸，再整体 transform: scale(k) 适配窗口。
   为什么不用百分比布局：牌与牌的重叠关系是靠"半格"整数算出来的，
   一旦让浏览器按百分比拉伸，半格就不再是整数，覆盖判定的视觉与逻辑会分家。
   ========================================================================= */
(function (SM) {
  'use strict';

  var PADDING = 24;   // 舞台四周留白（px），避免牌贴边
  var MAX_K = 1.3;    // 放大幅度上限：再大就会把 45 张牌放大成一面墙，
                      // 反而看不出"哪些是被压着的"
  var FLY_MS = 220;   // 入槽飞行时长（设计 §7.5）
  var SHUFFLE_MS = 620;  // 洗牌"聚拢—打乱—归位"的整段时长（R-12）

  /**
   * 洗牌动效的观感参数（P07 走查 S-5：原来这五个数散在函数体里裸着）。
   * 这些是**调出来的观感**，不是逻辑常量：R-12 时用"把动画钉在 46% 截图比对"的办法
   * 试过 0.62 / 0.78 / 0.9 三档收拢系数，最后选的这组。改这里只影响手感，不影响判定。
   */
  var MIX = {
    converge: 0.9,        // 朝舞台中心收拢的比例（0=原位不动，1=全部叠到中心）
    convergeJitter: 40,   // 收拢后叠的随机偏移幅度（px），有它才像"被手搅乱"
    rotate: 68,           // 随机旋转幅度（度）：-34° ~ +34°
    stagger: 14,          // 相邻两张的延迟差（ms），错开才有"一张张被翻"的层次
    staggerCount: 10,     // 参与错开的张数（超过就回到第一档）
    swapAt: 0.46          // 在第几成进度时换图案（最密集的一刻）
  };

  function Renderer(opts) {
    opts = opts || {};
    if (!opts.stageEl) throw new Error('Renderer: 缺少 stage 元素');
    if (!opts.trayEl) throw new Error('Renderer: 缺少 tray 元素');

    this._stage = opts.stageEl;
    this._wrap = opts.wrapEl || this._stage.parentNode;
    this._boardView = new SM.BoardView(this._stage);
    this._trayView = new SM.TrayView(opts.trayEl);
    // 暂存区视图（R-13）：移出的牌放这儿，可点回槽位
    this._holdingView = opts.holdingEl ? new SM.HoldingView(opts.holdingEl) : null;
    this._game = null;
    // HUD 是独立的一层（迭代 3 拆出）：这里只把 snapshot 递过去，不自己写数字
    this._hud = opts.hud || null;
    this._effects = opts.effects || null;   // 迭代 6：一次性视觉反馈（可为空）
    this._k = 1;
    this._maxCells = { w: 0, h: 0 };   // 一局之内舞台只增不减：牌少了舞台不该跟着缩
    this._lastConfig = null;
  }

  /* ------------------------------------------------------------------ 全量 */

  Renderer.prototype.render = function (game) {
    this._game = game;

    // 换关了：舞台尺寸的"只增不减"记忆要清掉
    if (game.config !== this._lastConfig) {
      this._lastConfig = game.config;
      this._maxCells = { w: 0, h: 0 };
    }

    if (game.iconSet !== this._boardView._iconSet) {
      this._boardView.setIconSet(game.iconSet);
      this._trayView.setIconSet(game.iconSet);
      if (this._holdingView) this._holdingView.setIconSet(game.iconSet);
    }

    this._boardView.render(game.board, game.config);
    this._trayView.render(game.tray);
    if (this._holdingView) this._holdingView.render(game.holding);
    this._updateHud(game);
    this.fit();
  };

  Renderer.prototype._updateHud = function (game) {
    if (!this._hud) return;
    this._hud.update(game.snapshot());
  };

  /* ------------------------------------------------------------------ 缩放 */

  /**
   * 等比缩放：k 取 MAX_K、宽度比、高度比三者最小。
   * 舞台像素尺寸直接问 DOM（offsetWidth），而不是再算一遍 `cells × u`——
   * 位置公式里还乘着一个 --spread，两处各写一份迟早会漂。
   * MAX_K 从 1.8 降到 1.25：1.8 在 1280×860 上会把牌放大到 100px 左右，
   * 满屏都是牌、看不出"哪些是被压着的"。
   */
  Renderer.prototype.fit = function () {
    var cells = this._boardView.cells();
    // 牌只会变少，舞台只增不减——否则每消一组，整副牌就"涨大"一次，非常晕
    if (cells.w > this._maxCells.w) this._maxCells.w = cells.w;
    if (cells.h > this._maxCells.h) this._maxCells.h = cells.h;

    var w = this._stage.offsetWidth;
    var h = this._stage.offsetHeight;
    if (!w || !h) return;

    var availW = this._wrap.clientWidth - PADDING * 2;
    var availH = this._wrap.clientHeight - PADDING * 2;
    var k = Math.min(MAX_K, availW / w, availH / h);
    if (!isFinite(k) || k <= 0) k = 1;

    // 只在变化超过 0.5% 时才写样式，避免拖窗口时每帧都触发重排
    if (Math.abs(k - this._k) > 0.005) {
      this._k = k;
      this._stage.style.transform = 'scale(' + k.toFixed(4) + ')';
    }
  };

  Renderer.prototype.bindResize = function () {
    var self = this;
    var pending = false;
    window.addEventListener('resize', function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; self.fit(); });
    });
  };

  /* ------------------------------------------------------------------ 动画 */

  /**
   * 降低动效（迭代 5，FR-26 / 设计 §7.6）：
   * 开启后所有动画时长视为 0 —— 不是"跳过设置"，而是让同一个流程立即走完，
   * 这样锁的释放、落地后的重渲染都还走原路径，不会出现"关掉动画后槽位不刷新"。
   */
  Renderer.prototype.setReduceMotion = function (on) {
    this._reduceMotion = !!on;
    document.body.classList.toggle('is-reduced-motion', this._reduceMotion);
    return this;
  };

  Renderer.prototype._dur = function (ms) {
    return this._reduceMotion ? 0 : ms;
  };

  /**
   * 入槽飞行（设计 §7.5）：牌堆里那张已经随模型变动被移除了，
   * 所以用一份"飞行层克隆"从原矩形飞到槽位矩形，落地后再把槽位渲染出来。
   * 期间上锁：动画中连点会被 Game 静默拒绝，不会出现两张牌同时飞。
   *
   * 锁怎么上（P07 走查 M-3）：视图只说"我要锁这么久"（`game.lockFor`），
   * 解锁由模型的定时器兜底，视图不再持有 unlock 的决定权——
   * 否则本函数中途抛异常时界面会永久点不动。
   */
  Renderer.prototype.playEnter = function (fromRect, result, game) {
    var self = this;
    // 先占位锁：即使下面同步部分就抛错，锁也会在 FLY_MS 后自动放开
    game.lockFor(this._dur(FLY_MS) + 80);
    this._stage.classList.add('is-locked');

    // 源节点立刻消失（模型里它已经不在牌堆/暂存区了），飞的是克隆
    this._boardView.render(game.board, game.config);
    if (this._holdingView) this._holdingView.render(game.holding);
    this._updateHud(game);

    var slotEl = this._trayView.slotEl(result.slotIndex);
    var toRect = slotEl ? slotEl.getBoundingClientRect() : null;

    function landed() {
      // 顺序不能反：先标记"这三张正在消失"（节点留在原位播缩小动画），
      // 再重排槽位——留下的人按新的槽号滑到前面，正是玩家期待的"补位"。
      var cleared = result.clearedTileIds || [];
      if (cleared.length) self._trayView.clearNodes(cleared);
      self._trayView.render(game.tray);
      if (self._holdingView) self._holdingView.render(game.holding);
      self._updateHud(game);
      self._stage.classList.remove('is-locked');
      // 不调 game.unlock()：lockFor 的定时器会放开（见函数头注释）
      // 表现层的即时反馈：凑齐三张时在槽位上方飘一句。
      // 这里只调 Effects，不碰任何模型状态（迭代 6 约束：动画不得改变状态）。
      if (cleared.length && self._effects && toRect) {
        // 锚在槽位上方一点：直接落在槽位中心会被底部的道具条裁掉一半
        self._effects.floatAt(toRect.left + toRect.width / 2,
                              toRect.top - 16, '凑齐三张');
      }
    }

    if (!fromRect || !toRect) { landed(); return; }
    if (this._reduceMotion) { landed(); return; }
    // 飞行层的图案必须来自"被点的那张牌"的模型数据（result.icon），
    // 不能去 DOM 里找——此刻源节点已经从舞台移除，随手 querySelector('.tile')
    // 拿到的是舞台上剩下的第一张牌（曾经的表现：不管点什么都飞出一只小猫）。
    this._fly(fromRect, toRect, game.iconSet, result.icon, landed);
  };

  Renderer.prototype._fly = function (fromRect, toRect, iconSet, iconKey, done) {
    var ghost = document.createElement('div');
    ghost.className = 'tile tile--fly';
    ghost.style.left = fromRect.left + 'px';
    ghost.style.top = fromRect.top + 'px';
    ghost.style.width = fromRect.width + 'px';
    ghost.style.height = fromRect.height + 'px';
    ghost.appendChild(SM.iconFace(iconSet, iconKey));

    document.body.appendChild(ghost);

    var dx = (toRect.left + toRect.width / 2) - (fromRect.left + fromRect.width / 2);
    var dy = (toRect.top + toRect.height / 2) - (fromRect.top + fromRect.height / 2);
    var scale = toRect.width / fromRect.width;

    var dur = this._dur(FLY_MS);
    // 下一帧才加 transition，否则浏览器会把"初始位置"和"目标位置"合并成一帧，看不到动画
    requestAnimationFrame(function () {
      ghost.style.transition = 'transform ' + dur + 'ms cubic-bezier(.2,.8,.2,1)';
      ghost.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + scale + ')';
    });

    window.setTimeout(function () {
      ghost.remove();
      done();
    }, dur + 20);
  };

  /** 无效点击：被压住的牌抖三下（FR-11），只动被点的那张 */
  Renderer.prototype.shake = function (tileId) {
    if (this._reduceMotion) return;   // 降低动效时不留"抖"这种最容易引发不适的动画
    var node = this._stage.querySelector('.tile[data-id="' + tileId + '"]');
    if (!node) return;
    node.classList.remove('is-shaking');
    // 强制读一次布局，让重复点击也能重新触发动画
    void node.offsetWidth;
    node.classList.add('is-shaking');
    window.setTimeout(function () {
      node.classList.remove('is-shaking');
    }, 400);
  };

  /**
   * 道具结果 → 动画（迭代 4）。
   * 这里**只**根据 Game 已经算好的结果播动画：
   * 移出播"落地闪一下"、洗牌播"整堆错动"、撤销只需重画。
   * 道具的业务判断一条都不在这里 —— 视图不知道"能不能用"、
   * 也不知道"该还几次"，它只知道"已经发生了什么"（DEP-3）。
   *
   * @param {String} propKind 'undo' | 'remove' | 'shuffle'
   * @param {Object} result   Game.useProp 的返回值
   */
  Renderer.prototype.playProp = function (propKind, result, game) {
    game = game || this._game;
    this.render(game);

    if (propKind === 'remove') {
      // R-13 之后"移出"落点是暂存区，不再是牌堆：闪动要给暂存区的节点
      var held = (result && result.detail && result.detail.held) || [];
      var ids = held.map(function (h) { return h.id; });
      if (this._holdingView) this._holdingView.flashLanding(ids);
      return;
    }

    if (propKind === 'shuffle') {
      this._playShuffle(game, result);
    }
  };

  /**
   * 洗牌动画：让"牌被搅乱"这件事真的发生（R-12）。
   *
   * 旧实现是给整堆牌加 ±7° 的抖动，玩家的反馈是"不像牌被打乱"——
   * 因为它只证明了"屏幕上发生了点什么"，没有表达"牌被聚起来又发回去"。
   *
   * 这一段按三个阶段做：
   *   ① **聚拢**：每张牌朝牌堆中心移动约 2/3 的距离，附带随机旋转与错开的起手延迟；
   *   ② **换面**：在牌最密集的一刻（约 46%）才把图标换成洗牌结果 ——
   *      只有"变化发生在牌翻飞的时候"，看起来才像洗牌；
   *   ③ **归位**：带回弹地飞回自己的格位。位置本身没有变（BR-08），
   *      变的是图案，所以归位时牌是"回到原位但换了张脸"。
   *
   * 全程上锁（`game.lock()`），避免玩家在牌还在飞的时候点中一张正在移动的牌。
   *
   * @param {Object} game   Game 实例（只读用）
   * @param {Object} result Game.useProp 的返回值，`detail.before` 是洗牌前的图标表
   */
  Renderer.prototype._playShuffle = function (game, result) {
    var self = this;
    var stage = this._stage;
    var nodes = Array.prototype.slice.call(stage.querySelectorAll('.tile[data-id]'));
    if (!nodes.length || this._reduceMotion) return;

    var detail = (result && result.detail) || {};
    var before = detail.before || null;

    // ① 先把牌面摆回"洗牌前"：`playProp` 已经渲染过新图标，
    //    这里立刻改回旧的（同一个任务里完成，不会有一帧闪烁）。
    if (before && before.get) {
      nodes.forEach(function (node) {
        var oldIcon = before.get(node.dataset.id);
        if (oldIcon) SM.iconFace.update(node.firstChild, game.iconSet, oldIcon);
      });
    }

    // 锁的时长要覆盖最慢的那张（错开延迟 + 归位），见下面 settle 的算法
    game.lockFor(SHUFFLE_MS + MIX.stagger * (MIX.staggerCount - 1) + 120);

    var stageRect = stage.getBoundingClientRect();
    var cx = stageRect.left + stageRect.width / 2;
    var cy = stageRect.top + stageRect.height / 2;

    nodes.forEach(function (node, i) {
      var rect = node.getBoundingClientRect();
      var px = rect.left + rect.width / 2;
      var py = rect.top + rect.height / 2;
      // 只朝中心收会像"整体缩小"，所以要叠一点随机偏移，才像被手搅乱；
      // 收拢系数见 MIX.converge：几乎全收到中间，只留一点原位置感，
      // 牌才不会糊成一坨看不清有几张（R-12 试了 0.62 / 0.78 / 0.9 三档）
      var dx = (cx - px) * MIX.converge + (Math.random() - 0.5) * MIX.convergeJitter;
      var dy = (cy - py) * MIX.converge + (Math.random() - 0.5) * MIX.convergeJitter;
      var rot = (Math.random() - 0.5) * MIX.rotate;          // 见 MIX.rotate（±34°）
      node.style.setProperty('--sx', dx.toFixed(1) + 'px');
      node.style.setProperty('--sy', dy.toFixed(1) + 'px');
      node.style.setProperty('--sr', rot.toFixed(1) + 'deg');
      node.style.setProperty('--sdelay', ((i % MIX.staggerCount) * MIX.stagger) + 'ms');
      node.classList.add('is-shuffling');
    });
    void stage.offsetWidth;   // 强制一次重排，保证同时点上也能重新触发

    // ② 最密集的一刻换面
    var swapped = false;
    var swap = function () {
      if (swapped) return;
      swapped = true;
      nodes.forEach(function (node) {
        var tile = game.board.get(node.dataset.id);
        if (tile) SM.iconFace.update(node.firstChild, game.iconSet, tile.icon);
      });
    };
    var swapTimer = window.setTimeout(swap, Math.round(SHUFFLE_MS * MIX.swapAt));

    // ③ 归位（错开的最大延迟也要等完，否则最后几张会被硬切回首帧）。
    //    解锁不在这里做：`lockFor` 的定时器会放开（M-3）——
    //    视图不该改模型状态（DEP-2），而且动画回调万一抛异常，unlock 就永远走不到。
    var settle = SHUFFLE_MS + MIX.stagger * (MIX.staggerCount - 1) + 60;
    window.setTimeout(function () {
      window.clearTimeout(swapTimer);
      swap();                       // 兜底：万一上面那次没跑到
      nodes.forEach(function (node) {
        node.classList.remove('is-shuffling');
        node.style.removeProperty('--sx');
        node.style.removeProperty('--sy');
        node.style.removeProperty('--sr');
        node.style.removeProperty('--sdelay');
      });
      self.render(game);
    }, settle);
  };

  SM.Renderer = Renderer;
})(window.SM = window.SM || {});



