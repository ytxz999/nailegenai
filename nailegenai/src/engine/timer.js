/* ============================================================================
   timer.js —— 引擎层：计时器（累计毫秒，暂停不跳变）
   为什么不用"记录开始时间、用 现在-开始 算用时"：
     那样一暂停就会把暂停的时长也算进去，恢复时时间"跳一下"。
   这里维护两个量：
     _accum   已累计的毫秒（每次暂停时把这一段结算进来）
     _started 本段开始的时刻（仅在计时中有效）
   任何时刻 elapsedMs() = _accum (+ 本段已过去的) ，暂停时 _started 失效、_accum 已经补齐，
   所以 暂停 → 等一小时 → 恢复，上屏的数字一动不动。
   ========================================================================= */
(function (SM) {
  'use strict';

  function Timer(opts) {
    opts = opts || {};
    // 允许注入时钟：自动化测试里可以"手动拨表"，不必真的等 3 秒
    this._now = opts.now || function () { return Date.now(); };
    this._accum = 0;
    this._startedAt = 0;
    this._running = false;
  }

  Timer.prototype.start = function () {
    if (this._running) return this;
    this._startedAt = this._now();
    this._running = true;
    return this;
  };

  Timer.prototype.pause = function () {
    if (!this._running) return this;
    this._accum += this._now() - this._startedAt;
    this._startedAt = 0;
    this._running = false;
    return this;
  };

  Timer.prototype.resume = function () {
    return this.start();
  };

  /** 终局：停止累加，但保留已用时长给结算页显示 */
  Timer.prototype.stop = function () {
    return this.pause();
  };

  Timer.prototype.reset = function () {
    this._accum = 0;
    this._startedAt = 0;
    this._running = false;
    return this;
  };

  Timer.prototype.isRunning = function () { return this._running; };

  /**
   * 直接设定已用时长（迭代 5 的读档用）。
   * 只写累计值、不动运行标志：调用方通常紧接着 start()，
   * 若这里顺手 resume，读档过程中就会多跑一段"恢复耗时"。
   */
  Timer.prototype.setElapsed = function (ms) {
    this._accum = Math.max(0, ms || 0);
    return this;
  };

  /** 当前已用毫秒。取整到毫秒，避免 HUD 上出现 12.0000001 秒这种数 */
  Timer.prototype.elapsedMs = function () {
    var ms = this._accum;
    if (this._running) ms += this._now() - this._startedAt;
    return Math.floor(ms);
  };

  /** 140 ms → "0:00"；65 400 ms → "1:05"；超过 1 小时 → "1:02:03" */
  Timer.format = function (ms) {
    var total = Math.floor((ms || 0) / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    if (h > 0) return h + ':' + pad(m) + ':' + pad(s);
    return m + ':' + pad(s);
  };

  Timer.prototype.toString = function () { return Timer.format(this.elapsedMs()); };

  SM.Timer = Timer;
})(window.SM = window.SM || {});
