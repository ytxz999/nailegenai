/* ============================================================================
   icon-face.js —— 表现层小工具：把"图标键"变成一DOM 节点
   为什么单独抽出来：牌堆视图、槽位视图、飞行层这三处都要建同一个 <img>，
   三份重复代码一旦改一处忘两处，就会出现"牌堆里是新图、飞行动画里是旧图"。
   只依赖 IconSet 的 src()/name()，不碰模型状态。
   ========================================================================= */
(function (SM) {
  'use strict';

  /**
   * @param {IconSet} iconSet 当前关卡的图标池
   * @param {string} key 图标键
   * @returns {HTMLImageElement}
   */
  function iconFace(iconSet, key) {
    var img = document.createElement('img');
    img.className = 'tile__icon';
    img.draggable = false;
    img.setAttribute('draggable', 'false');
    if (iconSet) {
      img.src = iconSet.src(key);
      img.alt = iconSet.name(key);
    }
    return img;
  }

  /** 就地换图：源相同就什么都不做（避免每次都重新解码图片） */
  iconFace.update = function (node, iconSet, key) {
    if (!node || !iconSet) return;
    var src = iconSet.src(key);
    if (node.getAttribute('src') !== src) {
      node.setAttribute('src', src);
      node.alt = iconSet.name(key);
    }
  };

  SM.iconFace = iconFace;
})(window.SM = window.SM || {});
