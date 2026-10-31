/* ============================================================================
   storage-adapter.js —— 数据层：localStorage 这层"介质"
   为什么把介质单独抽出来（设计 §3.12）：
     localStorage 在这个项目里有三种真实故障 ——
       ① 隐私模式 / 禁用 Cookie：访问 `window.localStorage` 直接抛异常；
       ② 容量超限：`setItem` 抛 QuotaExceededError；
       ③ 别人手改过的脏数据：`getItem` 拿回来的不是合法 JSON。
     这三种都属于"介质问题"，不该让 Repository 里混着 try/catch。
     Repository 只关心"存了什么语义"，这里只关心"能不能存进去"。
   ========================================================================= */
(function (SM) {
  'use strict';

  function StorageAdapter(backend) {
    // 可注入，方便 Node 环境下用假实现跑测试；浏览器里默认用 localStorage
    this._backend = backend === undefined ? safeLocalStorage() : backend;
    this._available = null;
  }

  /** 取 localStorage 时要包 try：某些浏览器在隐私模式下连"读属性"都会抛。 */
  function safeLocalStorage() {
    try {
      var ls = window.localStorage;
      var probe = '__sm_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return ls;
    } catch (err) {
      return null;
    }
  }

  StorageAdapter.prototype.isAvailable = function () {
    if (this._available === null) this._available = !!this._backend;
    return this._available;
  };

  /** 读：解析失败返回 null（并打日志），由 Repository 决定是"重来"还是"忽略"。 */
  StorageAdapter.prototype.read = function (key) {
    if (!this.isAvailable()) return null;
    var text;
    try {
      text = this._backend.getItem(key);
    } catch (err) {
      console.warn('[StorageAdapter] 读取失败：' + key, err);
      return null;
    }
    if (text === null || text === undefined) return null;
    try {
      return JSON.parse(text);
    } catch (err) {
      console.warn('[StorageAdapter] JSON 解析失败，已忽略该键：' + key, err);
      return null;
    }
  };

  /** 写：容量超限/隐私模式返回 false，不抛（调用方要能继续玩）。 */
  StorageAdapter.prototype.write = function (key, value) {
    if (!this.isAvailable()) return false;
    try {
      this._backend.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn('[StorageAdapter] 写入失败（可能超限）：' + key, err);
      return false;
    }
  };

  StorageAdapter.prototype.remove = function (key) {
    if (!this.isAvailable()) return;
    try {
      this._backend.removeItem(key);
    } catch (err) {
      console.warn('[StorageAdapter] 删除失败：' + key, err);
    }
  };

  /** 按前缀清理，供"重置全部数据"用。 */
  StorageAdapter.prototype.keys = function (prefix) {
    if (!this.isAvailable()) return [];
    var out = [];
    try {
      for (var i = 0; i < this._backend.length; i++) {
        var k = this._backend.key(i);
        if (k && k.indexOf(prefix) === 0) out.push(k);
      }
    } catch (err) {
      console.warn('[StorageAdapter] 枚举键失败', err);
    }
    return out;
  };

  SM.StorageAdapter = StorageAdapter;
})(window.SM = window.SM || {});
