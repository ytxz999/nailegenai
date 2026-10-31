/* ============================================================================
   dialogs.js —— 表现层：选关 / 暂停 / 结算三张弹窗
   三张弹窗长得一样（标题 + 若干行文字 + 若干按钮），差别只在内容，
   所以只写一个通用 show(opts)，由调用方拼按钮。
   弹窗本身**不改任何状态**：按钮点下去只是回调，真正的迁移发生在 Game 里。
   ========================================================================= */
(function (SM) {
  'use strict';

  function Dialogs() {
    this._root = document.createElement('div');
    this._root.className = 'modal is-hidden';
    this._root.setAttribute('role', 'dialog');
    this._root.setAttribute('aria-modal', 'true');

    this._panel = document.createElement('div');
    this._panel.className = 'modal__panel';

    this._title = document.createElement('h2');
    this._title.className = 'modal__title';

    this._body = document.createElement('div');
    this._body.className = 'modal__body';

    this._actions = document.createElement('div');
    this._actions.className = 'modal__actions';

    this._panel.appendChild(this._title);
    this._panel.appendChild(this._body);
    this._panel.appendChild(this._actions);
    this._root.appendChild(this._panel);
    document.body.appendChild(this._root);

    // Esc 关闭：只对"确认框"有意义（选关/结算这种没有取消语义的窗不挂回调，按了也不关）
    this._onEscape = null;
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && typeof this._onEscape === 'function') this._onEscape();
    }.bind(this));
  }

  /**
   * @param {Object} opts
   * @param {string}   opts.title
   * @param {string[]} [opts.lines]    正文段落
   * @param {Array}    opts.buttons    [{ label, kind:'primary'|'ghost', onClick }]
   */
  Dialogs.prototype.show = function (opts) {
    this._title.textContent = opts.title || '';
    this._body.innerHTML = '';
    (opts.lines || []).forEach(function (text) {
      var p = document.createElement('p');
      p.className = 'modal__line';
      p.textContent = text;
      this._body.appendChild(p);
    }, this);

    this._actions.innerHTML = '';
    var self = this;
    (opts.buttons || []).forEach(function (btn) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn' + (btn.kind === 'primary' ? ' btn--primary' : '');
      b.textContent = btn.label;
      b.addEventListener('click', function () {
        // 先关窗再回调：否则回调里一改状态、弹窗还盖在上面，看着像没反应
        self.hide();
        if (btn.onClick) btn.onClick();
      });
      self._actions.appendChild(b);
    });

    this._root.classList.remove('is-hidden');
    return this;
  };

  Dialogs.prototype.hide = function () {
    this._root.classList.add('is-hidden');
    this._onEscape = null;
    return this;
  };

  Dialogs.prototype.isOpen = function () {
    return !this._root.classList.contains('is-hidden');
  };

  /* ------------------------------------------------------------------ 确认 */

  /**
   * 二次确认（迭代 5：重开、返回选关、清空数据都要它）。
   * 返回 Promise 而不是回调，是因为调用点更想写成
   *   dialogs.confirm({...}).then(function (yes) { if (yes) ... })
   * 取消（点遮罩/按 Esc）也走 resolve(false)，不会留下悬挂的 Promise。
   */
  Dialogs.prototype.confirm = function (opts) {
    var self = this;
    return new Promise(function (resolve) {
      var settled = false;
      function finish(value) {
        if (settled) return;
        settled = true;
        self._onEscape = null;
        resolve(value);
      }
      self.show({
        title: opts.title,
        lines: opts.lines,
        buttons: [
          { label: opts.cancelLabel || '取消', kind: 'ghost', onClick: function () { finish(false); } },
          { label: opts.okLabel || '确定', kind: opts.danger ? 'ghost' : 'primary', onClick: function () { finish(true); } }
        ]
      });
      // Esc = 取消；只挂一次，避免连开两次确认时叠着多个监听
      self._onEscape = function () { self.hide(); finish(false); };
    });
  };

  /* ------------------------------------------------------------------ 吐司 */

  /**
   * 一行轻提示（"存档已失效，已重新开始"这类）。不进弹窗 ——
   * 弹窗要人点一下才消失，而这种消息玩家根本不需要回应。
   */
  Dialogs.prototype.toast = function (text, ms) {
    if (!this._toastEl) {
      this._toastEl = document.createElement('div');
      this._toastEl.className = 'toast is-hidden';
      document.body.appendChild(this._toastEl);
    }
    this._toastEl.textContent = text;
    this._toastEl.classList.remove('is-hidden');
    var el = this._toastEl;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(function () { el.classList.add('is-hidden'); }, ms || 2600);
    return this;
  };

  SM.Dialogs = Dialogs;
})(window.SM = window.SM || {});
