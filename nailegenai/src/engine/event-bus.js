/* ============================================================================
   event-bus.js —— 引擎层：事件总线
   存在的唯一理由：让"模型变了"与"界面要刷新"之间隔一层。
   如果 Game 直接调 renderer.refresh()，那么"消除后刷新"就和"消除逻辑"绑死，
   以后换界面就要改规则（设计 DEP-2 禁止这件事）。

   约定：事件名集中定义在 EVENTS 里，谁都不许在别处手写字符串。
   拼错一个字符串不会报错，只会"界面莫名其妙不刷新"，这类 bug 最费时间。
   ========================================================================= */
(function (SM) {
  'use strict';

  /** 全部事件名（设计 §7.5 的动画触发点也以这些名字为准） */
  var EVENTS = {
    LEVEL_STARTED: 'level:started',     // 新一关铺好牌
    TILE_ENTERED: 'tile:entered',       // 一张牌离开牌堆进入槽位（迭代 2 起）
    TILE_REJECTED: 'tile:rejected',     // 点击被拒（被覆盖）
    TILES_CLEARED: 'tiles:cleared',     // 三消命中
    BOARD_CHANGED: 'board:changed',     // 牌堆结构变了（洗牌、移出、撤销）
    TRAY_CHANGED: 'tray:changed',       // 槽位变了
    PROPS_CHANGED: 'props:changed',     // 道具次数变了
    STATE_CHANGED: 'state:changed'      // 游戏状态迁移
  };

  function EventBus() {
    this._handlers = new Map();   // 事件名 → [fn, ...]
  }

  /**
   * 订阅。返回一个取消订阅的函数 —— 
   * 用返回值而不是要求调用方记住同一个 fn 引用，是为了让"临时订阅"不容易泄漏。
   */
  EventBus.prototype.on = function (type, fn) {
    if (typeof fn !== 'function') throw new Error('EventBus.on: 处理函数必须是函数');
    var list = this._handlers.get(type);
    if (!list) { list = []; this._handlers.set(type, list); }
    list.push(fn);
    var self = this;
    return function off() { self.off(type, fn); };
  };

  EventBus.prototype.off = function (type, fn) {
    var list = this._handlers.get(type);
    if (!list) return;
    var i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };

  /**
   * 派发。用 slice() 复制一份再遍历：
   * 处理函数里再 on/off 时不会打乱本次遍历（否则会出现"跳过下一个订阅者"的诡异现象）。
   * 单个处理函数抛错不影响其它订阅者 —— 界面某处渲染失败，不该让整局游戏停摆。
   */
  EventBus.prototype.emit = function (type, payload) {
    var list = this._handlers.get(type);
    if (!list || !list.length) return 0;
    var snapshot = list.slice();
    var failed = 0;
    for (var i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i](payload);
      } catch (err) {
        failed++;
        if (window.console) console.error('[EventBus] 处理 ' + type + ' 时出错：', err);
      }
    }
    return snapshot.length - failed;
  };

  /** 调试用：某事件有几个订阅者 */
  EventBus.prototype.countOf = function (type) {
    var list = this._handlers.get(type);
    return list ? list.length : 0;
  };

  EventBus.prototype.clear = function () { this._handlers.clear(); };

  EventBus.EVENTS = EVENTS;
  SM.EVENTS = EVENTS;
  SM.EventBus = EventBus;
})(window.SM = window.SM || {});
