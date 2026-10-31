/* ============================================================================
   tray-view.js —— 表现层：槽位视图（7 个固定格 + 里面的牌）
   纪律（DEP-3）：只读 Tray，绝不写。

   P07 走查 S-2 之后这里只剩"声明差异"：格数来自 Tray.CAPACITY、
   格子叫 .slot、牌节点是 .tile--tray、整排满时挂 .is-full。
   共用的建格/全量同步/消除动画都在 slot-strip-view.js。
   ========================================================================= */
(function (SM) {
  'use strict';

  function TrayView(rootEl) {
    if (!rootEl) throw new Error('TrayView: 缺少根元素');
    SM.SlotStripView.call(this, {
      rootEl: rootEl,
      capacity: SM.Tray.CAPACITY,
      slotClass: 'slot',
      slotDataKey: 'slot',
      tileClass: 'tile tile--tray',
      fullClass: 'is-full'
    });
  }

  TrayView.prototype = Object.create(SM.SlotStripView.prototype);
  TrayView.prototype.constructor = TrayView;

  SM.TrayView = TrayView;
})(window.SM = window.SM || {});
