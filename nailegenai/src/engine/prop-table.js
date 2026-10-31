/* ============================================================================
   prop-table.js —— 道具登记表（P07 走查 S-1）

   为什么要这张表：
     原来"三种道具"这件事被写在五个地方——Game.useProp 的 if/else 分派、
     PropManager.KINDS 与 LABELS、PropBar.GLYPH、sound.js 的音名、main.js 里
     选音效的那行三元表达式。加第四种道具要改五处，而少改一处不会报错，
     只会表现为"按钮点了没反应"这类静默 bug。

     现在这张表是**唯一**的 kind 清单：kind → { 显示名、图标、由 Game 的哪个方法执行 }。
     Game 只做 `this[spec.method]()`，不再认识具体是哪种道具；
     视图从表里取 label/glyph，模型层只从表里取 kind 列表做次数校验。

   注意分层的分寸：表里存的是 kind、文案、图标和"方法名"，不存函数——
     函数仍是 Game 的私有方法，这样道具效果依然写在 Game 里（而不是散到视图），
     表只负责"把 kind 路由到方法"。
   ========================================================================= */
(function (SM) {
  'use strict';

  var TABLE = {
    undo: {
      kind: 'undo',
      label: '撤销',
      glyph: '↩',
      method: '_undoOne',
      hint: '退回上一步（牌、槽位、道具次数一起退）',
      // 次数还有但栈空（刚开局）时，按钮应当置灰：点下去必然被拒
      enable: function (ctx) { return (ctx.snapshot.canUndo || 0) > 0; }
    },
    remove: {
      kind: 'remove',
      label: '移出',
      glyph: '⇪',
      method: '_removeThree',
      hint: '把槽位最早的几张拿进暂存区',
      // 暂存区满了就点不动（R-13 之后"移出"的落点是暂存区）
      enable: function (ctx) { return !ctx.holdingFull; }
    },
    shuffle: {
      kind: 'shuffle',
      label: '洗牌',
      glyph: '⇄',
      method: '_shuffleIcons',
      hint: '重排牌堆里未消除牌的图案（位置与遮挡不变）'
    }
  };

  var KINDS = Object.keys(TABLE);

  /** 取一条登记；kind 不存在返回 null（调用方自行决定是 noop 还是抛错） */
  function get(kind) {
    return Object.prototype.hasOwnProperty.call(TABLE, kind) ? TABLE[kind] : null;
  }

  SM.PROP_TABLE = TABLE;
  SM.PropTable = {
    KINDS: KINDS,
    get: get,
    has: function (kind) { return !!get(kind); },
    label: function (kind) { var s = get(kind); return s ? s.label : kind; },
    glyph: function (kind) { var s = get(kind); return s ? s.glyph : '?'; }
  };
})(window.SM = window.SM || {});
