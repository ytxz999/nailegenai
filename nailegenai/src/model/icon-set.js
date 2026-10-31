/* ============================================================================
   icon-set.js —— 模型层：图标池（IconSet）
   职责：持有"全部可用图标"的定义，按关卡需要的种类数取前 N 种。
   为什么单独成类：
      图标是"牌面的语义"，Board 只关心"同不同"，不关心"长什么样"；
      把"图标键 → 素材"的映射收在这里，换肤只改一个文件。

   素材说明：牌面用「奶家族谱」里的 16 个角色图（assets/nai/*.png，
   已去白底、转成透明 PNG，见 docs/07-AI交互记录.md 的 R-09）。
   模型层只提供"文件路径 + 中文名"，不碰 DOM；真正建 <img> 的是 view/icon-face.js。
   ========================================================================= */
(function (SM) {
  'use strict';

  // 顺序 = "取前 N 种"的顺序。前 8 个是全套里**轮廓差异最大**的：
  // 青蛙、狗、鸡、兔、茶杯、老鼠、猫、奶瓶——三关分别只用 5/6/8 种，
  // 所以要先保证"最少的 5 种也能一眼分开"，而不是按族谱原顺序排。
  var ALL_ICONS = [
    { key: 'wa',     name: '奶蛙',       src: 'assets/nai/wa.png' },
    { key: 'gou',    name: '奶狗',       src: 'assets/nai/gou.png' },
    { key: 'ji',     name: '奶鸡',       src: 'assets/nai/ji.png' },
    { key: 'tu',     name: '奶兔',       src: 'assets/nai/tu.png' },
    { key: 'cha',    name: '奶茶',       src: 'assets/nai/cha.png' },
    { key: 'shu',    name: '奶鼠',       src: 'assets/nai/shu.png' },
    { key: 'mao',    name: '奶猫',       src: 'assets/nai/mao.png' },
    { key: 'ping',   name: '奶瓶',       src: 'assets/nai/ping.png' },
    { key: 'shi',    name: '奶屎',       src: 'assets/nai/shi.png' },
    { key: 'yu',     name: '奶鱼',       src: 'assets/nai/yu.png' },
    { key: 'dan',    name: '奶蛋',       src: 'assets/nai/dan.png' },
    { key: 'xiaowa', name: '小奶蛙',     src: 'assets/nai/xiaowa.png' },
    { key: 'dou',    name: '奶豆',       src: 'assets/nai/dou.png' },
    { key: 'fen',    name: '奶粉',       src: 'assets/nai/fen.png' },
    { key: 'dounai', name: '豆奶',       src: 'assets/nai/dounai.png' },
    { key: 'sigma',  name: '西格玛奶蛙', src: 'assets/nai/sigma.png' }
  ];

  /**
   * @param {number} kinds 本关使用的图标种类数（1～16）
   */
  function IconSet(kinds) {
    if (!Number.isInteger(kinds) || kinds < 1 || kinds > ALL_ICONS.length) {
      throw new Error('IconSet: kinds 必须在 1～' + ALL_ICONS.length + ' 之间，收到 ' + kinds);
    }
    this.kinds = kinds;
    this._pool = ALL_ICONS.slice(0, kinds);     // 取前 N 种，顺序固定，便于复现
  }

  IconSet.ALL = ALL_ICONS;

  /** 本关可用的图标键数组，如 ['wa','dan','xiaowa'] */
  IconSet.prototype.keys = function () {
    return this._pool.map(function (it) { return it.key; });
  };

  /** 图标键 → 定义对象；未知键直接抛错，避免"牌面空白"这种静默故障 */
  IconSet.prototype.entry = function (key) {
    for (var i = 0; i < this._pool.length; i++) {
      if (this._pool[i].key === key) return this._pool[i];
    }
    throw new Error('IconSet: 未知图标键 ' + key);
  };

  /** 图标键 → 素材路径（相对 index.html） */
  IconSet.prototype.src = function (key) {
    return this.entry(key).src;
  };

  /** 图标键 → 中文名（alt、提示、控制台输出用） */
  IconSet.prototype.name = function (key) {
    return this.entry(key).name;
  };

  /** 按索引取图标键（生成器用：第 g 组用 icons[g % kinds]） */
  IconSet.prototype.at = function (index) {
    return this._pool[index % this._pool.length].key;
  };

  SM.IconSet = IconSet;
})(window.SM = window.SM || {});
