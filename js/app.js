/*!
 * 军旗 · 陆战棋 —— 交互入口
 */
(function (root) {
  'use strict';

  var R = root.JunqiRules;
  var Engine = root.JunqiEngine;
  var Render = root.JunqiRender;
  var AI = root.JunqiAI;

  var PREFS_KEY = 'junqi.prefs';

  var ui = {
    selected: null,
    hints: [],
    busy: false,
    level: 'normal',
    sound: true,
    lastMove: null,
    overlayDismissed: false
  };

  var game = new Engine.Game();
  var aiTimer = null;
  var boardEl, toastEl, soundBtn;

  /* ---------------- 音效 ---------------- */
  var Sound = (function () {
    var ctx = null, on = true;

    function ensure() {
      if (ctx) return ctx;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { ctx = null; }
      return ctx;
    }

    function tone(freq, start, dur, type, gain) {
      var c = ensure();
      if (!c) return;
      var o = c.createOscillator(), g = c.createGain();
      var t0 = c.currentTime + start;
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(gain || 0.05, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(c.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.03);
    }

    return {
      setOn: function (v) { on = !!v; if (on) ensure(); },
      unlock: function () {
        var c = ensure();
        if (c && c.state === 'suspended') c.resume();
      },
      play: function (kind) {
        if (!on) return;
        var c = ensure();
        if (!c) return;
        if (c.state === 'suspended') c.resume();
        if (kind === 'select') tone(760, 0, 0.05, 'triangle', 0.028);
        else if (kind === 'swap') { tone(520, 0, 0.06, 'triangle', 0.032); tone(680, 0.06, 0.07, 'triangle', 0.028); }
        else if (kind === 'move') tone(300, 0, 0.07, 'triangle', 0.045);
        else if (kind === 'clash') { tone(190, 0, 0.1, 'sawtooth', 0.05); tone(120, 0.05, 0.16, 'square', 0.035); }
        else if (kind === 'win') { tone(523, 0, 0.14, 'triangle', 0.05); tone(659, 0.13, 0.14, 'triangle', 0.05); tone(784, 0.26, 0.28, 'triangle', 0.05); }
        else if (kind === 'lose') { tone(330, 0, 0.16, 'sawtooth', 0.042); tone(220, 0.15, 0.3, 'sawtooth', 0.038); }
        else if (kind === 'error') tone(150, 0, 0.1, 'square', 0.038);
        else if (kind === 'start') { tone(392, 0, 0.1, 'triangle', 0.045); tone(523, 0.1, 0.16, 'triangle', 0.045); }
      }
    };
  })();

  /* ---------------- 偏好 ---------------- */
  function loadPrefs() {
    try {
      var raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      if (raw && AI.LEVELS[raw.level]) ui.level = raw.level;
      if (raw && typeof raw.sound === 'boolean') ui.sound = raw.sound;
    } catch (e) { /* 忽略损坏的本地存储 */ }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ level: ui.level, sound: ui.sound }));
    } catch (e) { /* 隐私模式下不可写，忽略 */ }
  }

  /* ---------------- 提示 ---------------- */
  var toastTimer = null;
  function toast(msg, isErr) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('err', !!isErr);
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, 2200);
  }

  /* ---------------- 开局 ---------------- */
  function newGame(withToast) {
    clearTimeout(aiTimer);
    aiTimer = null;
    game.reset();
    ui.selected = null;
    ui.hints = [];
    ui.busy = false;
    ui.lastMove = null;
    ui.overlayDismissed = false;
    Render.clearPieces();
    Render.render(game, ui);
    if (withToast) toast('新的一局 · 请布阵');
  }

  /* ---------------- 点击棋盘 ---------------- */
  function cellFromEvent(e) {
    var rect = boardEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    var x = Math.floor((e.clientX - rect.left) / rect.width * 12);
    var y = Math.floor((e.clientY - rect.top) / rect.height * 5);
    if (x < 0 || x > 11 || y < 0 || y > 4) return null;
    return { x: x, y: y, key: R.key(x, y) };
  }

  function onBoardClick(e) {
    if (ui.busy) return;
    var c = cellFromEvent(e);
    if (!c) return;

    /* --- 布阵阶段：交换两枚己方棋子 --- */
    if (game.phase === 'setup') {
      var p = game.board.get(c.key);
      if (!p || p.side !== 'red') {
        ui.selected = null;
        Render.render(game, ui);
        return;
      }
      if (!ui.selected) {
        ui.selected = c.key;
        Sound.play('select');
        Render.render(game, ui);
        return;
      }
      if (ui.selected === c.key) {
        ui.selected = null;
        Render.render(game, ui);
        return;
      }
      if (game.swap(ui.selected, c.key)) Sound.play('swap');
      else {
        toast('该位置不符合布阵规则', true);
        Sound.play('error');
      }
      ui.selected = null;
      Render.render(game, ui);
      return;
    }

    if (game.phase !== 'playing' || game.turn !== 'red') return;

    /* --- 落子 --- */
    var sel = ui.selected ? game.board.get(ui.selected) : null;
    if (sel) {
      var hit = null;
      for (var i = 0; i < ui.hints.length; i++) {
        var h = ui.hints[i];
        if (h.x === c.x && h.y === c.y && h.type !== 'mark') { hit = h; break; }
      }
      if (hit) { playMove(ui.selected, c.key); return; }
    }

    /* --- 选子 --- */
    var piece = game.board.get(c.key);
    if (piece && piece.side === 'red') {
      if (ui.selected === c.key) {
        ui.selected = null;
        ui.hints = [];
      } else {
        ui.selected = c.key;
        ui.hints = game.movesFrom(c.x, c.y).map(function (m) {
          return { x: m.x, y: m.y, type: m.capture ? 'cap' : '' };
        });
        Sound.play('select');
      }
      Render.render(game, ui);
      return;
    }

    ui.selected = null;
    ui.hints = [];
    Render.render(game, ui);
  }

  function playMove(fromKey, toKey) {
    var f = R.parse(fromKey), t = R.parse(toKey);
    var ev = game.move(f[0], f[1], t[0], t[1]);
    if (!ev) {
      toast('无效走法', true);
      Sound.play('error');
      return;
    }

    ui.selected = null;
    ui.hints = [];
    ui.lastMove = { from: ev.from, to: ev.to };
    Sound.play(ev.def ? 'clash' : 'move');
    if (ev.def) announceClash(ev);

    if (game.phase === 'over') {
      ui.busy = false;
      Render.render(game, ui);
      endSound();
      return;
    }

    ui.busy = true;
    Render.render(game, ui);
    aiTimer = setTimeout(aiTurn, 640);
  }

  function announceClash(ev) {
    var to = R.parse(ev.to);
    var text;
    if (ev.type === 'atk') text = ev.atk.name + ' 胜';
    else if (ev.type === 'def') text = ev.def.name + ' 守住';
    else if (ev.type === 'both') text = '同归于尽';
    else text = '夺旗！';
    Render.clash(to[0], to[1], text, ev.type === 'def');
  }

  /* ---------------- AI 回合 ---------------- */
  function aiTurn() {
    aiTimer = null;
    if (game.phase !== 'playing' || game.turn !== 'blue') {
      ui.busy = false;
      Render.render(game, ui);
      return;
    }

    var mv = AI.choose(game, 'blue', ui.level);
    if (!mv) {
      ui.busy = false;
      Render.render(game, ui);
      return;
    }

    var ev = game.move(mv.fx, mv.fy, mv.tx, mv.ty);
    ui.busy = false;
    if (ev) {
      ui.lastMove = { from: ev.from, to: ev.to };
      Sound.play(ev.def ? 'clash' : 'move');
      if (ev.def) announceClash(ev);
    }
    Render.render(game, ui);
    if (game.phase === 'over') endSound();
  }

  function endSound() {
    if (game.winner === 'red') Sound.play('win');
    else if (game.winner === 'blue') Sound.play('lose');
    else Sound.play('swap');
  }

  /* ---------------- 工具栏 ---------------- */
  function giveHint() {
    if (game.phase !== 'playing' || game.turn !== 'red') {
      toast('现在轮不到你', true);
      return;
    }
    var mv = AI.choose(game, 'red', 'hard');
    if (!mv) {
      toast('没有可走的棋', true);
      return;
    }
    ui.selected = null;
    ui.hints = [
      { x: mv.fx, y: mv.fy, type: 'mark' },
      { x: mv.tx, y: mv.ty, type: game.board.has(mv.toKey) ? 'cap' : 'mark' }
    ];
    Render.render(game, ui);
    toast('参谋建议：把高亮棋子走到高亮位置');
  }

  function onToolbarClick(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    var act = btn.getAttribute('data-act');

    if (act === 'shuffle') {
      game.shuffleRed();
      ui.selected = null;
      Render.render(game, ui);
      Sound.play('swap');
      toast('已随机重排红方阵型');
    } else if (act === 'start') {
      game.start();
      ui.selected = null;
      ui.hints = [];
      ui.lastMove = null;
      ui.busy = false;
      Render.render(game, ui);
      Sound.play('start');
      if (game.phase === 'playing') toast('战斗开始 · 红方先行');
    } else if (act === 'level') {
      ui.level = btn.getAttribute('data-level');
      savePrefs();
      Render.render(game, ui);
      toast('对手难度：' + AI.levelOf(ui.level).label);
    } else if (act === 'undo') {
      if (game.undo()) {
        ui.selected = null;
        ui.hints = [];
        ui.lastMove = game.lastMove;
        Render.render(game, ui);
        Sound.play('swap');
        toast('已悔棋');
      } else {
        toast('现在不能悔棋', true);
      }
    } else if (act === 'hint') {
      giveHint();
    } else if (act === 'resign') {
      clearTimeout(aiTimer);
      aiTimer = null;
      game.resign();
      ui.busy = false;
      Render.render(game, ui);
      Sound.play('lose');
    } else if (act === 'reset') {
      newGame(true);
    } else if (act === 'again') {
      ui.overlayDismissed = false;
      newGame(true);
    }
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    boardEl.addEventListener('click', onBoardClick);

    document.getElementById('toolbar').addEventListener('click', onToolbarClick);
    document.getElementById('newGameBtn').addEventListener('click', function () { newGame(true); });

    document.getElementById('overlay').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'close') {
        ui.overlayDismissed = true;
        document.getElementById('overlay').classList.remove('is-on');
      } else if (act === 'again') {
        ui.overlayDismissed = false;
        newGame(true);
      }
    });

    soundBtn.addEventListener('click', function () {
      ui.sound = !ui.sound;
      Sound.setOn(ui.sound);
      savePrefs();
      soundBtn.setAttribute('aria-pressed', String(ui.sound));
      if (ui.sound) Sound.play('select');
      toast(ui.sound ? '音效已开启' : '音效已关闭');
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        ui.selected = null;
        ui.hints = [];
        Render.render(game, ui);
      }
    });

    document.addEventListener('pointerdown', function unlock() {
      Sound.unlock();
      document.removeEventListener('pointerdown', unlock);
    });
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    boardEl = document.getElementById('board');
    toastEl = document.getElementById('toast');
    soundBtn = document.getElementById('soundBtn');

    loadPrefs();
    Sound.setOn(ui.sound);
    soundBtn.setAttribute('aria-pressed', String(ui.sound));

    Render.init();
    bind();
    newGame(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
