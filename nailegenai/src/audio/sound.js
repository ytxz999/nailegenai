/* ============================================================================
   sound.js —— 表现层：WebAudio 合成音效（不引入任何音频文件）
   职责边界（设计 §3.14 / DEP-2）：
     · 只"听事件、发音"，不改任何游戏状态，也不被模型层认识；
     · 开关状态由设置面板给（settings.sound），本模块只负责 setEnabled；
     · 所有音都靠振荡器 / 噪声缓冲合成——NFR-01 要求双击即跑、不发网络请求，
       所以一个 mp3 都不能有。
   浏览器策略：AudioContext 必须在"用户手势"之后才能出声（否则 suspended），
   所以第一次点击/按键时调 unlock()，之后的 play() 才真正有声音。
   ========================================================================= */
(function (SM) {
  'use strict';

  /** 音量总控：整条链上再乘一次，方便演示时整体压低 */
  var MASTER = 0.6;

  function Sound(opts) {
    opts = opts || {};
    this.enabled = opts.enabled !== false;
    this._ctx = null;
    this._master = null;
    this._muted = !this.enabled;
  }

  /* ---------------------------------------------------------------- 内部工具 */

  Sound.prototype._ensure = function () {
    if (this._ctx) return this._ctx;
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;                 // 老浏览器：静默降级，不影响游戏
    try {
      this._ctx = new Ctor();
      this._master = this._ctx.createGain();
      this._master.gain.value = MASTER;
      this._master.connect(this._ctx.destination);
    } catch (err) {
      this._ctx = null;
      console.warn('[Sound] 无法创建 AudioContext：', err);
    }
    return this._ctx;
  };

  /**
   * 单个音符：osc → gain(包络) → master
   * at 是相对当前时间的偏移（秒），用于把几个音符排成琶音。
   */
  Sound.prototype._tone = function (freq, at, dur, type, gain, slideTo) {
    var ctx = this._ctx;
    var t0 = ctx.currentTime + at;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    // 快速起音、指数衰减：短促的"嗒"声，不会糊在一起
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this._master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  };

  /** 洗牌用的一声"哗啦"：白噪声 + 带通滤波扫频 + 包络 */
  Sound.prototype._noise = function (dur, gain) {
    var ctx = this._ctx;
    var t0 = ctx.currentTime;
    var frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

    var src = ctx.createBufferSource();
    src.buffer = buffer;

    var filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(700, t0);
    filter.frequency.exponentialRampToValueAtTime(2600, t0 + dur * 0.55);
    filter.frequency.exponentialRampToValueAtTime(900, t0 + dur);

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.18);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(filter);
    filter.connect(g);
    g.connect(this._master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  };

  /* ------------------------------------------------------------------ 对外 */

  /** 第一次用户手势时调用：把被浏览器挂起的上下文唤醒 */
  Sound.prototype.unlock = function () {
    var ctx = this._ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended' && ctx.resume) {
      ctx.resume().catch(function () { /* 用户没给权限就算了，静音即可 */ });
    }
  };

  Sound.prototype.setEnabled = function (on) {
    this.enabled = !!on;
    if (this._master) {
      // 用 0 而不是 disconnect：播放中的音符能自然收尾，不会"啪"一下断掉
      this._master.gain.value = this.enabled ? MASTER : 0;
    }
  };

  Sound.prototype.isEnabled = function () {
    return this.enabled;
  };

  /**
   * 播放一个音效。名字来自设计 §7.5 的触发表：
   *   enter 入槽 / clear 三消 / reject 点了不能点的牌 / shuffle 洗牌
   *   remove 移出 / undo 撤销 / win 通关 / lose 失败 / empty 道具次数用尽
   */
  Sound.prototype.play = function (name) {
    if (!this.enabled) return;
    var ctx = this._ensure();
    if (!ctx || ctx.state === 'suspended') return;   // 还没解锁：不报错，直接跳过

    try {
      switch (name) {
        case 'enter':
          this._tone(720, 0, 0.09, 'sine', 0.10, 560);
          break;
        case 'clear':
          // 三连音上行：和"三张凑齐"这件事对得上
          this._tone(784, 0.00, 0.10, 'triangle', 0.11);
          this._tone(988, 0.06, 0.10, 'triangle', 0.10);
          this._tone(1319, 0.12, 0.16, 'triangle', 0.09);
          break;
        case 'reject':
          this._tone(190, 0, 0.10, 'square', 0.05, 120);
          break;
        case 'shuffle':
          this._noise(0.62, 0.16);           // 620ms，和洗牌动画同长
          break;
        case 'remove':
          this._tone(520, 0.00, 0.09, 'sine', 0.09, 660);
          this._tone(660, 0.07, 0.10, 'sine', 0.08);
          break;
        case 'undo':
          this._tone(560, 0.00, 0.08, 'sine', 0.08, 420);
          this._tone(420, 0.06, 0.10, 'sine', 0.07);
          break;
        case 'win':
          this._tone(523, 0.00, 0.14, 'triangle', 0.12);
          this._tone(659, 0.12, 0.14, 'triangle', 0.12);
          this._tone(784, 0.24, 0.14, 'triangle', 0.12);
          this._tone(1047, 0.36, 0.30, 'triangle', 0.11);
          break;
        case 'lose':
          this._tone(392, 0.00, 0.16, 'sine', 0.10, 330);
          this._tone(262, 0.14, 0.22, 'sine', 0.10, 196);
          break;
        case 'empty':
          this._tone(300, 0, 0.07, 'square', 0.04, 220);
          break;
        default:
          console.warn('[Sound] 未知音效：' + name);
      }
    } catch (err) {
      // 音效永远不该让游戏崩：出错就静音继续
      console.warn('[Sound] 播放 ' + name + ' 失败：', err);
    }
  };

  /** 设置面板要展示的清单（也方便以后加"音量"项） */
  Sound.CUES = ['enter', 'clear', 'reject', 'shuffle', 'remove', 'undo', 'win', 'lose', 'empty'];

  SM.Sound = Sound;
}(window.SM = window.SM || {}));
