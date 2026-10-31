/* ============================================================================
   settings-panel.js —— 表现层：设置面板（音效 / 降低动效 / 清空数据）
   为什么单独一个文件而不是塞进 dialogs.js：
     弹窗只负责"长什么样、按了哪个钮"，设置面板要读 Repository、要立刻生效、
     还要在改完设置后把改动写回存储 —— 这是"业务动作"，混进通用弹窗会让
     弹窗从"无状态的壳"变成"知道存储的壳"，以后加结算弹窗也得带着这堆依赖。
   ========================================================================= */
(function (SM) {
  'use strict';

  /**
   * @param {Object} opts
   * @param {SM.Dialogs}     opts.dialogs
   * @param {SM.Repository}  opts.repo
   * @param {Function}       opts.onChange  (settings) → void  设置一变就通知外部
   */
  function SettingsPanel(opts) {
    this._dialogs = opts.dialogs;
    this._repo = opts.repo;
    this._onChange = opts.onChange || function () {};
    this._settings = this._repo.loadSettings();
  }

  SettingsPanel.prototype.current = function () {
    return this._settings;
  };

  SettingsPanel.prototype.get = function (key) {
    return this._settings[key];
  };

  SettingsPanel.prototype.open = function () {
    var self = this;
    var s = this._settings;
    var lines = [
      '音效：' + (s.sound ? '开' : '关') + '（音效在迭代 6 接入，开关先记下来）',
      '降低动效：' + (s.reduceMotion ? '开' : '关'),
      '提示：刷新后可以继续上局，但撤销记录不会保留。'
    ];

    this._dialogs.show({
      title: '设置',
      lines: lines,
      buttons: [
        {
          label: (s.sound ? '关闭音效' : '开启音效'),
          kind: 'ghost',
          onClick: function () { self.toggle('sound'); self.open(); }
        },
        {
          label: (s.reduceMotion ? '关闭降低动效' : '开启降低动效'),
          kind: 'ghost',
          onClick: function () { self.toggle('reduceMotion'); self.open(); }
        },
        {
          label: '清空全部数据',
          kind: 'ghost',
          onClick: function () {
            self._dialogs.confirm({
              title: '清空全部数据？',
              lines: ['将删除存档、最佳记录与设置，且无法恢复。'],
              okLabel: '清空',
              danger: true
            }).then(function (yes) {
              if (!yes) { self.open(); return; }
              self._repo.clearAll();
              self._settings = self._repo.loadSettings();
              self._onChange(self._settings);
              self._dialogs.toast('已清空全部数据');
              self.open();
            });
          }
        },
        { label: '关闭', kind: 'primary', onClick: function () {} }
      ]
    });
  };

  /**
   * 改一项并立刻落盘 + 通知外部。
   * 立刻写而不是"关窗时统一写"：设置就三个开关，用户改完可能直接关页面，
   * 攒着写最容易丢的就是这种"小改动"。
   */
  SettingsPanel.prototype.toggle = function (key) {
    var next = {};
    for (var k in this._settings) if (Object.prototype.hasOwnProperty.call(this._settings, k)) next[k] = this._settings[k];
    next[key] = !next[key];
    this._settings = this._repo.saveSettings(next);
    this._onChange(this._settings);
    return this._settings;
  };

  SettingsPanel.prototype.set = function (key, value) {
    var next = {};
    for (var k in this._settings) if (Object.prototype.hasOwnProperty.call(this._settings, k)) next[k] = this._settings[k];
    next[key] = value;
    this._settings = this._repo.saveSettings(next);
    this._onChange(this._settings);
    return this._settings;
  };

  SM.SettingsPanel = SettingsPanel;
})(window.SM = window.SM || {});
