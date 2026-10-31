/* ============================================================================
   tile.js —— 模型层：一张牌（Tile）
   职责边界（分析 §2 / 设计 §3.1）：
     · 只持有自己的数据与状态，不认识 DOM、不认识 Board 的索引、不认识 Game；
     · 不负责渲染，也不负责"我能不能点"——那是 Board 的判定；
     · moveTo / setState 是"被容器调用的内部操作"，不是牌自己能做的动作。
       因此它们会检查"我确实被某个容器接管了"，防止出现
       "牌改了位置、却没人更新占用索引"这种最难查的错位 bug。
   ========================================================================= */
(function (SM) {
  'use strict';

  // 四态：board（在牌堆）/ tray（在槽位）/ holding（被"移出"拿到暂存区，R-13）/ cleared（已消除）
  var TILE_STATES = ['board', 'tray', 'holding', 'cleared'];

  /**
   * 抖动幅度（px）。±9 ≈ 牌宽 56px 的 1/6，是 FR-06 给的"不超过 1/6"上限。
   * 曾一度归零（R-15 想把画面"理干净"），但试玩后用户否掉：去掉抖动后整片牌
   * 排得过于规整、像在排队，"手摆出来的自然感"没了。所以恢复 ±9。
   */
  var JITTER_RANGE = 9;

  /**
   * 由 id 派生一个稳定的抖动值：同一次刷新、同一张牌，偏移量始终一样。
   * 为什么不用 Math.random()：
   *   ① 截图对比时牌面会"跳"一下，看不清改动到底是逻辑还是抖动；
   *   ② 排查"点 A 选中 B"时，如果每次抖动都变，就无法复现。
   */
  function hashJitter(id, salt) {
    var h = 2166136261 ^ salt;          // FNV-1a 变体，够用且很短
    for (var i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    // 映射到 [-JITTER_RANGE, JITTER_RANGE]（当前即 [-9, 9]）
    var span = JITTER_RANGE * 2 + 1;
    return (h % span) - JITTER_RANGE;
  }

  function Tile(id, icon, layer, col, row, group) {
    if (typeof id !== 'string' || !id) throw new Error('Tile: id 必须是非空字符串');
    if (typeof icon !== 'string' || !icon) throw new Error('Tile: icon 必须是非空字符串');
    if (!Number.isInteger(layer) || layer < 0) throw new Error('Tile: layer 必须是 >=0 的整数');
    if (!Number.isInteger(col) || !Number.isInteger(row)) throw new Error('Tile: col/row 必须是整数（半格单位）');

    this.id = id;
    this.icon = icon;
    this.layer = layer;
    this.col = col;          // 半格单元坐标：col = 2*c + layer%2（设计 §3.5）
    this.row = row;
    this.state = 'board';    // 生成即在牌堆中
    this.group = (group === undefined) ? -1 : group;   // 三张一组的编号，洗牌按组置换

    // 纯视觉抖动，±9px，不参与任何判定（FR-06）
    this.jitterX = hashJitter(id, 7);
    this.jitterY = hashJitter(id, 19);

    this._board = null;      // 当前接管的 Board，仅用于断言，不参与业务判断
  }

  Tile.STATES = TILE_STATES;

  /** 加入牌堆时由 Board 调用 */
  Tile.prototype.attachTo = function (board) {
    if (this._board && this._board !== board) {
      throw new Error('Tile ' + this.id + ' 已属于另一个 Board');
    }
    this._board = board;
  };

  /** 离开牌堆时由 Board 调用 */
  Tile.prototype.detach = function (board) {
    if (this._board === board) this._board = null;
  };

  /**
   * 改位置。只允许 Board 在自己的 add/remove 流程里调用——
   * 这里能做的只是"检查有没有被接管"，做不到真正的访问控制（JS 没有友元），
   * 但它足以在开发期把"随手改坐标"这种写法立刻暴露出来。
   */
  Tile.prototype.moveTo = function (layer, col, row) {
    if (!this._board) throw new Error('Tile ' + this.id + ' 不在任何 Board 中，不能改位置');
    if (!Number.isInteger(layer) || !Number.isInteger(col) || !Number.isInteger(row)) {
      throw new Error('Tile.moveTo: 参数必须是整数');
    }
    this.layer = layer;
    this.col = col;
    this.row = row;
  };

  Tile.prototype.setState = function (state) {
    if (TILE_STATES.indexOf(state) < 0) throw new Error('Tile.setState: 非法状态 ' + state);
    this.state = state;
  };

  /**
   * 改图标（"洗牌"道具用，P07 走查 M-1 补）。
   * 为什么要有这个方法：icon 不是纯展示数据——它是 Tray.findTriple 的判据、
   * 是 I-4"每种图标张数 %3"的统计维度。之前三处（洗牌、洗牌回滚、洗牌的撤销）
   * 都是直接 `t.icon = ...`，等于给这条不变量开了个没守门人的后门：
   * 写错成空值不会报错，只会表现为"永远凑不齐"。
   */
  Tile.prototype.setIcon = function (icon) {
    if (typeof icon !== 'string' || !icon) throw new Error('Tile.setIcon: icon 必须是非空字符串');
    this.icon = icon;
  };

  /**
   * 未接管时设定落位——"移出"道具把牌从槽位抛回牌堆的溢出层就属于这种情况：
   * 此刻牌既不在牌堆里（没有 Board 可改索引），又必须先把坐标摆好才能 add。
   * 与 moveTo 的分工：moveTo 管"已在牌堆中挪位置"（必须经过 Board 改索引），
   * placeAt 管"还没进牌堆，先摆好"。
   */
  Tile.prototype.placeAt = function (layer, col, row) {
    if (this._board) throw new Error('Tile ' + this.id + ' 已在 Board 中，改位置请用 moveTo');
    if (!Number.isInteger(layer) || !Number.isInteger(col) || !Number.isInteger(row)) {
      throw new Error('Tile.placeAt: 参数必须是整数');
    }
    this.layer = layer;
    this.col = col;
    this.row = row;
  };

  // 说明：这里原本有一个 `Tile.prototype.faceRect(u, spread)`（按 col/row 算像素矩形）。
  // 渲染早已全部交给 CSS（`board.css` 用 --col/--row/--jx/--jy 算 left/top），
  // 热区靠 `getBoundingClientRect()`，它成了没有调用者的死代码；
  // 而且默认 spread 与 base.css 的 --spread 已经对不上（1.3 vs 1.5），
  // 留着只会被人当成"坐标的唯一真相"去算热区，得到"看着在这、算出来在那"的错位。
  // P07 走查（S-6）删除。

  SM.Tile = Tile;
})(window.SM = window.SM || {});

