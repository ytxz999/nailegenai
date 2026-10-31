/* ============================================================================
   holding-view.js —— 表现层：暂存区视图（3 个固定格 + 里面的牌）
   纪律（DEP-3）：只读 Holding，绝不写。

   P07 走查 S-2 之后这里只剩"声明差异"：
   格数来自 Holding.CAPACITY、格子叫 .slot--holding、牌节点多一个 .tile--holding
   （那个类带 cursor:pointer 与 hover 上浮——暂存区里的牌**可以点回槽位**，槽位里的不能）。
   其余全部继承 slot-strip-view.js。
   ========================================================================= */
(function (SM) {
  'use strict';

  function HoldingView(rootEl) {
    if (!rootEl) throw new Error('HoldingView: 缺少根元素');
    SM.SlotStripView.call(this, {
      rootEl: rootEl,
      capacity: SM.Holding.CAPACITY,
      slotClass: 'slot slot--holding',
      slotDataKey: 'holdingSlot',
      tileClass: 'tile tile--tray tile--holding',
      fullClass: 'is-full'
    });
  }

  HoldingView.prototype = Object.create(SM.SlotStripView.prototype);
  HoldingView.prototype.constructor = HoldingView;

  SM.HoldingView = HoldingView;
})(window.SM = window.SM || {});
