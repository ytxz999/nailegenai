/* ============================================================================
   undo-manager.js —— 引擎层：撤销栈
   只管三件事：压栈、弹栈、别无限长。
   它不认识牌、不认识槽位、也不认识道具 —— 那些都在命令自己的 undo 里。
   ========================================================================= */
(function (SM) {
  'use strict';

  /**
   * 缺省上限：从关卡配置那边取（P07 走查 S-5，原来是这里和 level-config.js 各写一个 30）。
   * 取不到时（脚本顺序被改坏）才退化成字面量，并且在控制台叫一声，
   * 免得"两处默认值悄悄不一致"这种问题留到线上才暴露。
   */
  var DEFAULT_LIMIT = (function () {
    if (SM.LevelConfig && SM.LevelConfig.DEFAULT_UNDO_LIMIT !== undefined) {
      return SM.LevelConfig.DEFAULT_UNDO_LIMIT;
    }
    console.warn('[UndoManager] 没读到 LevelConfig.DEFAULT_UNDO_LIMIT，退回 30');
    return 30;
  })();

  /**
   * @param {Number} [limit] 栈上限（来自关卡配置的 undoStackLimit）
   *   上限存在两个理由：
   *     · 一局最多 144 次点击，不设限等于把整局的操作都留在内存里；
   *     · 撤销次数本来就有上限（BR-13），栈比次数长没有意义。
   */
  function UndoManager(limit) {
    var lim = (limit === undefined || limit === null) ? DEFAULT_LIMIT : limit;
    if (!Number.isInteger(lim) || lim < 1) throw new Error('UndoManager: 上限必须是正整数');
    this._limit = lim;
    this._stack = [];
  }

  UndoManager.DEFAULT_LIMIT = DEFAULT_LIMIT;

  Object.defineProperty(UndoManager.prototype, 'limit', { get: function () { return this._limit; } });

  UndoManager.prototype.size = function () { return this._stack.length; };
  UndoManager.prototype.canUndo = function () { return this._stack.length > 0; };
  UndoManager.prototype.clear = function () { this._stack.length = 0; return this; };

  /** 压栈；超出上限时丢掉**最旧**的那条（新的更有撤销价值） */
  UndoManager.prototype.push = function (cmd) {
    if (!cmd || typeof cmd.undo !== 'function') throw new Error('UndoManager.push: 需要一个带 undo() 的命令');
    this._stack.push(cmd);
    while (this._stack.length > this._limit) this._stack.shift();
    return this;
  };

  UndoManager.prototype.peek = function () {
    return this._stack.length ? this._stack[this._stack.length - 1] : null;
  };

  /**
   * 撤销栈顶一条。
   * 成功后**不**把这条命令压到"重做栈"：本项目没有重做（F5 之外没有正向还原入口），
   * 而且"撤销本身再被撤销"会让撤销次数被无限套娃，验收口径也会变得说不清。
   * 失败时把命令放回栈顶 —— 撤销失败通常是索引已经漂了，此时最不该做的就是静默吞掉。
   */
  UndoManager.prototype.undo = function (ctx) {
    if (!this._stack.length) return { ok: false, reason: 'empty-stack' };
    var cmd = this._stack.pop();
    try {
      var res = cmd.undo(ctx) || { ok: true };
      if (res.ok === false) {
        this._stack.push(cmd);
        return res;
      }
      return { ok: true, cmd: cmd };
    } catch (err) {
      this._stack.push(cmd);
      console.error('[UndoManager] 撤销 ' + cmd.type + ' 失败：', err);
      return { ok: false, reason: 'undo-error', error: err };
    }
  };

  /** 调试用：栈内命令的类型序列（从栈底到栈顶） */
  UndoManager.prototype.types = function () {
    return this._stack.map(function (c) { return c.type; });
  };

  SM.UndoManager = UndoManager;
})(window.SM = window.SM || {});
