/* ============================================================================
   schema.js —— 数据层：键名、版本、默认值、校验与格式化
   为什么单独一个文件（设计 §2.3 / §3.12）：
     键名、版本号、默认设置这三样东西会被「Repository 写」「Repository 读」
     「设置面板改」「重置按钮清」四处同时引用。写死四处，改一次键名要改四个文件，
     而且漏改一处就变成"读得到、写不回"这种只在特定路径下才复现的 bug。
   ========================================================================= */
(function (SM) {
  'use strict';

  var KEYS = {
    save: 'nailegenai.save',
    best: 'nailegenai.best',
    settings: 'nailegenai.settings'
  };

  var VERSION = 1;

  /* 默认设置（设计 §5.5）。
     sound 默认开，但首帧不播任何声音 —— 浏览器的自动播放策略要求
     AudioContext 先有一次用户手势才能 resume。 */
  var DEFAULT_SETTINGS = { v: VERSION, sound: true, reduceMotion: false, helpSeen: false };

  /* 最佳记录每关保留条数（设计 §5.4）。 */
  var MAX_RECORDS = 5;

  /**
   * 关卡参数指纹：参数一改，旧存档就作废。
   * 只取"决定局面形状"的四项 —— 难度微调（比如道具次数从 3 变 2）
   * 不该让玩家正在玩的这局作废，所以 props 不进指纹。
   */
  function configHash(config) {
    return [config.id, config.layers, config.cols, config.rows, config.perIconCount].join(':');
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function isNonNegativeInt(value) {
    return typeof value === 'number' && isFinite(value) && value >= 0 && Math.floor(value) === value;
  }

  /**
   * 校验并归一化设置：缺字段补默认、类型不对退回默认。
   * 为什么"归一化"而不是"校验失败就整体丢弃"：
   * 以后加了 `sound` 之外的字段，旧存档不该因为"少了新字段"被判成损坏。
   */
  function normalizeSettings(raw) {
    var out = { v: VERSION, sound: DEFAULT_SETTINGS.sound, reduceMotion: DEFAULT_SETTINGS.reduceMotion, helpSeen: DEFAULT_SETTINGS.helpSeen };
    if (!isPlainObject(raw)) return out;
    if (typeof raw.sound === 'boolean') out.sound = raw.sound;
    if (typeof raw.reduceMotion === 'boolean') out.reduceMotion = raw.reduceMotion;
    if (typeof raw.helpSeen === 'boolean') out.helpSeen = raw.helpSeen;
    return out;
  }

  function emptyBest() {
    return { v: VERSION, records: { beginner: [], advanced: [], challenge: [] } };
  }

  /** 记录比较器：用时升序，用时相同按步数升序（设计 §5.4）。 */
  function compareRecord(a, b) {
    if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
    return a.moves - b.moves;
  }

  SM.schema = {
    KEYS: KEYS,
    VERSION: VERSION,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    MAX_RECORDS: MAX_RECORDS,
    configHash: configHash,
    isPlainObject: isPlainObject,
    isNonNegativeInt: isNonNegativeInt,
    normalizeSettings: normalizeSettings,
    emptyBest: emptyBest,
    compareRecord: compareRecord
  };
})(window.SM = window.SM || {});
