/* ============================================================================
   main.js —— 装配（只有这个文件认识全部类型）
   顺序按设计 §2.4：schema → StorageAdapter → Repository → config → iconSet
   → board/tray → game → view → 绑定。

   页面有四个"面"，全靠状态机驱动：
     Idle    → 选关弹窗（迭代 5 起还会先问"是否继续上局"）
     Playing → 牌堆 + 槽位 + HUD（计时在走）
     Paused  → 暂停弹窗（表停住，点击被状态闸门挡住）
     Won/Lost→ 结算弹窗（表已停，显示定格用时）
   弹窗只负责"显示与回调"，状态迁移一律发生在 Game 里 —— 这样"暂停后不能操作"
   不是靠弹窗挡住点击，而是 Game.can('click') 就不允许。
   ========================================================================= */
(function (SM) {
  'use strict';

  var TICK_MS = 200;       // HUD 刷新间隔：计时显示到秒，200ms 足够跟手且不浪费
  var SAVE_DEBOUNCE = 300; // 存档节流（设计 §5.1）

  function boot() {
    /* ---------- ① 关卡配置：三关读出来并自校验 ---------- */
    var levelErrors = [];
    SM.levels.list.forEach(function (lv) {
      var errs = lv.validate();
      if (errs.length) levelErrors.push(lv.id + '：' + errs.join('；'));
    });
    if (levelErrors.length) {
      throw new Error('关卡配置不合法：\n' + levelErrors.join('\n'));
    }

    /* ---------- ② 数据层：介质 → 仓库（迭代 5） ---------- */
    var repo = new SM.Repository(new SM.StorageAdapter());

    /* ---------- ③ 图标池：取全部 8 种，每关用前 iconKinds 个 ---------- */
    // 池子做满 8 种而不是每关新建一个：视图层只认一次 iconSet，
    // 换关时不必重建渲染管线，也不会出现"图标键对不上"的诡异空白牌。
    var iconSet = new SM.IconSet(SM.IconSet.ALL.length);

    /* ---------- ④ 模型与引擎 ---------- */
    var board = new SM.Board();
    var tray = new SM.Tray();
    // 暂存区（R-13）：移出道具的落点，3 格，牌可以点回槽位
    var holding = new SM.Holding();
    var bus = new SM.EventBus();
    var game = new SM.Game({
      board: board,
      tray: tray,
      holding: holding,
      iconSet: iconSet,
      bus: bus,
      // 迭代 3：换成"保证有解"的生成器（原来是写死的 fixture）
      builder: function (config, icons) { return SM.levelGenerator.build(config, icons); }
    });

    /* ---------- ⑤ 视图 ---------- */
    var hud = new SM.HUD({
      level: document.getElementById('hud-level'),
      remaining: document.getElementById('hud-remaining'),
      moves: document.getElementById('hud-moves'),
      time: document.getElementById('hud-time'),
      state: document.getElementById('hud-state'),
      pauseBtn: document.getElementById('btn-pause')
    });

    /* 迭代 6：表现层两个新件——音效（WebAudio 合成）与一次性反馈（飘字/回弹） */
    var sound = new SM.Sound({ enabled: true });
    var effects = new SM.Effects({ hostEl: document.getElementById('stage-wrap') });

    var renderer = new SM.Renderer({
      stageEl: document.getElementById('stage'),
      wrapEl: document.getElementById('stage-wrap'),
      trayEl: document.getElementById('tray'),
      holdingEl: document.getElementById('holding'),
      hud: hud,
      effects: effects
    });
    renderer.bindResize();

    var input = new SM.Input({
      stageEl: document.getElementById('stage'),
      holdingEl: document.getElementById('holding'),
      game: game,
      renderer: renderer
    });
    input.bind();

    var dialogs = new SM.Dialogs();

    /* 道具条（迭代 4）：只负责"把点击转给 Game"，可用性由 snapshot 决定 */
    var propBar = new SM.PropBar(document.getElementById('propbar'));
    propBar.bindUse(function (kind) {
      var res = game.useProp(kind);
      if (!res.ok) {
        if (res.reason === 'empty-stack') dialogs.hide();
        console.warn('[prop] ' + kind + ' 被拒：' + res.reason);
        return;
      }
      renderer.playProp(kind, res, game);
      sound.play(kind);   // 三种道具的音名与 kind 同名（undo / remove / shuffle），不必再映射
      refreshHudAndProps();
    });

    /* 设置面板（迭代 5）：改完立刻落盘，并立刻生效（降低动效要当场看得见） */
    var settings = new SM.SettingsPanel({
      dialogs: dialogs,
      repo: repo,
      onChange: applySettings
    });
    applySettings(settings.current());

    function applySettings(s) {
      renderer.setReduceMotion(s.reduceMotion);
      effects.setReduceMotion(s.reduceMotion);
      sound.setEnabled(s.sound);
    }

    /* 浏览器要求"用户手势之后"才能出声：第一次点击/按键时把音频上下文唤醒。
       用 once 语义（首次后解绑），避免每点一下都调一次 resume。 */
    function unlockAudio() {
      sound.unlock();
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    }
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    /* ---------- ⑥ 存档：节流自动保存（设计 §5.1） ---------- */

    var saveTimer = null;

    /** 只有"进行中/暂停"才值得存：终局与未开局都不存（清了就是清了） */
    function savable() {
      return !!game.config && (game.state === 'Playing' || game.state === 'Paused');
    }

    function scheduleSave() {
      if (!savable()) return;
      if (saveTimer) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(saveNow, SAVE_DEBOUNCE);
    }

    function saveNow() {
      if (saveTimer) { window.clearTimeout(saveTimer); saveTimer = null; }
      if (!savable()) return;
      repo.saveGame(game);
    }

    // 切后台/关页面时必须立刻写一次：节流的 300ms 里关掉页面就丢最后一步
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') saveNow();
    });
    window.addEventListener('beforeunload', saveNow);

    /* ---------- ⑦ 四个面的切换 ---------- */

    function showLevels() {
      var buttons = SM.levels.list.map(function (lv) {
        var best = repo.bestOf(lv.id);
        return {
          label: '进入「' + lv.name + '」 ' + lv.tileCount + ' 张' +
                 (best ? '　最佳 ' + SM.Timer.format(best.timeMs) + ' / ' + best.moves + ' 步' : ''),
          kind: lv.id === 'beginner' ? 'primary' : undefined,
          onClick: function () { startLevel(lv); }
        };
      });
      var lines = ['点一张没被压住的牌，它飞进底部槽位；同图标凑满三张立即消除。',
                   '槽位满 7 张且这一次没凑成三张 → 失败。'];
      dialogs.show({ title: '奶了个奶', lines: lines, buttons: buttons });
    }

    function startLevel(config) {
      // 进新关就等于放弃上一局的存档：设计上只保留"最近进入的关卡"这一份
      repo.clearGame();
      effects.clearAll();          // 上一局飞到一半的飘字不能留到这一局
      game.startLevel(config);
      renderer.render(game);
      refreshHudAndProps();
      tickTimer();
      saveNow();
    }

    /** 从存档恢复。失败（版本/参数变化/脏数据）由 Repository 清键并置 lastError */
    function continueSaved(data) {
      try {
        game.restore(data);
      } catch (err) {
        console.error('[repo] 恢复失败：', err);
        repo.clearGame();
        dialogs.toast('存档已失效，已重新开始');
        showLevels();
        return false;
      }
      renderer.render(game);
      refreshHudAndProps();
      tickTimer();
      // 撤销栈不进存档（DD-06），刷新后按钮该是灰的
      dialogs.toast('已恢复上局；刷新前的操作不能撤销');
      return true;
    }

    /** HUD 与道具条共用一份 snapshot：两处各取一次会出现"数字差一帧"的错觉 */
    function refreshHudAndProps() {
      var snap = game.snapshot();
      hud.update(snap);
      propBar.render(snap);
    }

    function showPause() {
      dialogs.show({
        title: '已暂停',
        lines: ['计时已停住，牌面不会响应点击。'],
        buttons: [
          { label: '继续', kind: 'primary', onClick: function () { game.resume(); } },
          { label: '重开本关', onClick: confirmRestart },
          { label: '返回选关', onClick: confirmBack }
        ]
      });
    }

    /**
     * 重开要二次确认（迭代 5 验收项）。
     * 取消时要把暂停面板放回来 —— 否则玩家点了"重开"又点"取消"，
     * 会看到一个没有面板的空牌桌，还以为自己把游戏弄坏了。
     */
    function confirmRestart() {
      dialogs.confirm({
        title: '重开本关？',
        lines: ['当前进度会丢失，最佳记录不受影响。'],
        okLabel: '重开'
      }).then(function (yes) {
        if (!yes) { if (game.state === 'Paused') showPause(); return; }
        game.restart();
        renderer.render(game);
        refreshHudAndProps();
        tickTimer();
        saveNow();
      });
    }

    function confirmBack() {
      dialogs.confirm({
        title: '返回选关？',
        lines: ['本局会保存，下次可以继续。'],
        okLabel: '返回'
      }).then(function (yes) {
        if (!yes) { if (game.state === 'Paused') showPause(); return; }
        if (game.state === 'Playing') game.pause();
        saveNow();
        showLevels();
      });
    }

    function showResult(snap, best) {
      var won = snap.state === 'Won';
      var lines = [
        (won ? '牌堆已清空。' : '槽位满了，这一次没凑成三张。'),
        '关卡：' + snap.levelName,
        '用时：' + SM.Timer.format(snap.elapsedMs) + '　步数：' + snap.moves,
        '剩余牌：' + snap.remaining
      ];
      if (won && best) {
        lines.push(best.isNew ? '★ 新纪录：' + SM.Timer.format(snap.elapsedMs) + ' / ' + snap.moves + ' 步'
                              : '本关最佳仍是 ' + SM.Timer.format(repo.bestOf(snap.levelId).timeMs) + '，这次第 ' + (best.rank + 1) + ' 名');
      } else if (!won) {
        lines.push('失败不记入最佳记录。');
      }
      dialogs.show({
        title: won ? '通关！' : '失败',
        lines: lines,
        buttons: [
          { label: won ? '再玩一次' : '重开本关', kind: 'primary', onClick: function () { startLevel(game.config); } },
          { label: '返回选关', onClick: showLevels }
        ]
      });
      // 通关多一层暖光（纯表现；失败不发光，让"赢/输"第一眼就分得开）
      if (won) {
        var panel = document.querySelector('.modal__panel');
        if (panel) {
          panel.classList.add('is-won');
          window.setTimeout(function () { panel.classList.remove('is-won'); }, 1500);
        }
      }
    }

    /* 状态迁移 → 弹窗（唯一的入口，避免"暂停时又弹出结算"这类叠加） */
    bus.on(SM.EVENTS.STATE_CHANGED, function (payload) {
      var snap = game.snapshot();

      if (payload.state === 'Paused') {
        saveNow();                       // 暂停是"人要走开"的信号，立刻落盘
        showPause();
      } else if (payload.state === 'Won' || payload.state === 'Lost') {
        var best = null;
        if (payload.state === 'Won') {
          best = repo.submitBest(snap.levelId, { timeMs: snap.elapsedMs, moves: snap.moves });
        }
        sound.play(payload.state === 'Won' ? 'win' : 'lose');
        // 终局后这局已经没有"继续"的意义，存档必须清掉，否则下次启动会问"继续吗"
        repo.clearGame();
        // 等动画收尾再弹：牌刚飞进槽就盖上一层黑幕，观感很差
        window.setTimeout(function () { showResult(game.snapshot(), best); }, 420);
      } else if (payload.state === 'Playing') {
        dialogs.hide();
      }
      hud.update(snap);
      propBar.render(snap);
    });

    /* 牌面/槽位/道具次数变化 → 两处读数同步 + 排一次存档 */
    [SM.EVENTS.BOARD_CHANGED, SM.EVENTS.TRAY_CHANGED, SM.EVENTS.PROPS_CHANGED].forEach(function (type) {
      bus.on(type, function () {
        refreshHudAndProps();
        scheduleSave();
      });
    });

    /* 音效：只"听事件"，不改状态（演出的顺序感全在这里） */
    bus.on(SM.EVENTS.TILE_ENTERED, function (payload) {
      sound.play(payload && payload.source === 'holding' ? 'remove' : 'enter');
    });
    bus.on(SM.EVENTS.TILES_CLEARED, function () {
      sound.play('clear');            // 三连音：和"三张凑齐"对上
    });
    bus.on(SM.EVENTS.TILE_REJECTED, function () {
      sound.play('reject');           // 点了被压住的牌：短促的"不行"
    });

    /* 暂停按钮与设置按钮 */
    hud.bindPause(function () { game.pause(); });
    var settingsBtn = document.getElementById('btn-settings');
    if (settingsBtn) settingsBtn.addEventListener('click', function () { settings.open(); });

    /* 计时节拍：只在进行中刷新，暂停/终局时表本来就不走了 */
    var tickHandle = null;
    function tickTimer() {
      if (tickHandle) window.clearInterval(tickHandle);
      tickHandle = window.setInterval(function () {
        if (game.state === 'Playing') hud.setTime(game.timer.elapsedMs());
      }, TICK_MS);
    }
    tickTimer();

    /* 键盘：空格暂停/继续（手感细节，不涉及规则） */
    window.addEventListener('keydown', function (ev) {
      if (ev.code !== 'Space') return;
      if (ev.target && /^(INPUT|TEXTAREA|BUTTON)$/.test(ev.target.tagName)) return;
      ev.preventDefault();
      if (game.state === 'Playing') game.pause();
      else if (game.state === 'Paused') game.resume();
    });

    /* ---------- ⑧ 调试出口 ---------- */
    SM.app = {
      game: game,
      board: board,
      tray: tray,
      holding: holding,
      input: input,
      renderer: renderer,
      hud: hud,
      propBar: propBar,
      dialogs: dialogs,
      settings: settings,
      repo: repo,
      iconSet: iconSet,
      sound: sound,
      effects: effects,
      startLevel: startLevel,
      showLevels: showLevels,
      saveNow: saveNow,
      report: report
    };

    /* ---------- ⑨ 启动：有存档先问"继续吗"，否则直接选关 ---------- */
    var saved = repo.loadGame();
    if (saved) {
      var cfg = SM.levels.byId(saved.levelId);
      dialogs.show({
        title: '继续上局？',
        lines: [
          '关卡：' + cfg.name,
          '已用 ' + SM.Timer.format(saved.elapsedMs) + '　步数 ' + saved.moves +
            '　剩余 ' + (saved.tiles.length) + ' 张',
          '恢复后可以接着玩，但刷新前的操作不能撤销。'
        ],
        buttons: [
          { label: '继续', kind: 'primary', onClick: function () { continueSaved(saved); } },
          { label: '重新选关', onClick: function () { repo.clearGame(); showLevels(); } }
        ]
      });
    } else {
      if (repo.lastError) dialogs.toast('存档已失效，已重新开始');
      showLevels();
    }
    refreshHudAndProps();
    console.log(report());
  }

  /** 人类可读的自检报告：验收时直接看这一段 */
  function report() {
    var app = SM.app;
    var game = app.game;

    var lines = [];
    lines.push('奶了个奶 · 迭代 5 自检（三关 / 生成器 / 计时 / 道具 / 存档 / 最佳记录）');
    lines.push('');

    lines.push('关卡表（总张数必须是 3 的倍数）：');
    SM.levels.list.forEach(function (lv) {
      var perIconOk = lv.perIconCount % 3 === 0 ? '✓' : '✗';
      lines.push('  · ' + lv.name + '（' + lv.id + '）' +
        lv.layers + ' 层 × ' + lv.cols + ' 列 × ' + lv.rows + ' 行 = ' + lv.tileCount + ' 张' +
        '，' + lv.iconKinds + ' 种 × ' + lv.perIconCount + ' 张 ' + perIconOk +
        '，' + lv.groupCount() + ' 组，道具 ' + lv.props.undo + '/' + lv.props.remove + '/' + lv.props.shuffle);
    });
    lines.push('');

    lines.push('存档与设置（迭代 5）：');
    lines.push('  · localStorage 可用：' + (app.repo._db.isAvailable() ? '是' : '否（隐私模式/被禁用时会退化为"不保存"）'));
    lines.push('  · 存档键：' + SM.schema.KEYS.save + '　最佳：' + SM.schema.KEYS.best + '　设置：' + SM.schema.KEYS.settings);
    lines.push('  · 版本号：' + SM.schema.VERSION + '　最佳记录每关保留 ' + SM.schema.MAX_RECORDS + ' 条');
    lines.push('  · 当前设置：' + JSON.stringify(app.settings.current()));
    SM.levels.list.forEach(function (lv) {
      var best = app.repo.bestOf(lv.id);
      lines.push('  · ' + lv.name + ' 最佳：' +
        (best ? SM.Timer.format(best.timeMs) + ' / ' + best.moves + ' 步' : '暂无记录'));
    });
    lines.push('');

    lines.push('当前局面：' + game.state +
      '　用时 ' + SM.Timer.format(game.timer.elapsedMs()) +
      '　步数 ' + game.stats.moves +
      '　牌堆 ' + board.size() + ' / 槽位 ' + tray.size() + ' / 暂存 ' + holding.size());
    lines.push('');
    lines.push('手工验证入口：');
    lines.push('  SM.app.startLevel(SM.levels.byId(\'beginner\'))     // 直接进某一关');
    lines.push('  SM.app.holding.toArray()                           // 暂存区里的牌（R-13 的落点）');
    lines.push('  SM.app.game.clickTile(SM.app.holding.toArray()[0].id) // 把暂存的牌点回槽位');
    lines.push('  SM.app.saveNow()                                   // 立刻存一次（不必等节流）');
    lines.push('  SM.app.repo.loadGame()                             // 看存档长什么样：纯对象，无类实例');
    lines.push('  SM.app.repo.submitBest(\'beginner\', {timeMs: 60000, moves: 40})  // 手工提交成绩');
    lines.push('  SM.app.repo.loadBest()                             // 三关最佳记录（每关最多 5 条）');
    lines.push('  SM.app.settings.set(\'reduceMotion\', true)          // 开关降低动效（立刻生效）');
    lines.push('  SM.app.repo.clearAll()                             // 清空存档/记录/设置');
    lines.push('  SM.app.game.pause() / .resume() / .restart()        // 暂停 / 继续 / 重开');
    lines.push('  SM.app.game.useProp(\'undo\' | \'remove\' | \'shuffle\') // 用道具（走命令，可被撤销）');
    lines.push('  SM.app.game.assertInvariants()                      // 五条不变式逐条报告');
    return lines.join('\n');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.SM = window.SM || {});
