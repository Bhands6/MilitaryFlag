/*!
 * 军旗 · 陆战棋 —— 联机客户端
 * 依赖 socket.io.js（由 server.js 在 /socket.io/socket.io.js 提供）。
 * 棋盘只负责展示服务端下发的视图，走子/布阵全部经服务端裁决。
 */
(function (root) {
  'use strict';

  var R = root.JunqiRules;
  var E = root.JunqiEngine;
  var Render = root.JunqiRender;

  var ui = {
    mode: 'online',
    selected: null,
    hints: [],
    busy: false,
    level: 'normal',
    sound: true,
    lastMove: null,
    overlayDismissed: false,
    youSide: null
  };

  var game = null;
  var socket = null;
  var key = null;
  var currentCode = null;
  var bound = false;
  var prevCombat = 0;

  function toast(msg, err) {
    if (root.JunqiToast) root.JunqiToast(msg, err);
  }

  function sound(kind) {
    if (root.JunqiSound) root.JunqiSound.play(kind);
  }

  function getKey() {
    var k = null;
    try { k = localStorage.getItem('junqi.online.key'); } catch (e) { /* 隐私模式 */ }
    if (!k) {
      k = 'k' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { localStorage.setItem('junqi.online.key', k); } catch (e) { /* 忽略 */ }
    }
    return k;
  }

  function ack(event, payload) {
    return new Promise(function (resolve) {
      if (!socket) return resolve({ ok: false, error: '未连接服务器' });
      socket.timeout(3000).emit(event, payload || {}, function (err, res) {
        resolve(err ? { ok: false, error: '请求超时，请重试' } : res);
      });
    });
  }

  function cellFromEvent(e) {
    var board = document.getElementById('board');
    var rect = board.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    var x = Math.floor((e.clientX - rect.left) / rect.width * 12);
    var y = Math.floor((e.clientY - rect.top) / rect.height * 5);
    if (x < 0 || x > 11 || y < 0 || y > 4) return null;
    return { x: x, y: y, key: R.key(x, y) };
  }

  /** 用服务端视图填充一个本地 Game 实例，只用于渲染和生成可走点提示 */
  function buildGame(view) {
    var g = new E.Game();
    g.board = new Map(view.board);
    g.phase = view.phase;
    g.turn = view.turn;
    g.round = view.round;
    g.winner = view.winner;
    g.reason = view.reason;
    g.flagRevealed = { red: view.flagRevealed.red, blue: view.flagRevealed.blue };
    g.log = view.log || [];
    g.graveyard = view.graveyard || [];
    g.stats = view.stats || { clashes: 0, redLost: 0, blueLost: 0 };
    g.lastMove = view.lastMove;
    g.players = view.players || {};
    g.code = view.code;
    g.myTurn = view.myTurn;
    g.you = view.you;
    ui.youSide = view.you;
    return g;
  }

  function applyView(view) {
    var before = game;
    game = buildGame(view);

    if (before && before.phase === 'over' && game.phase !== 'over') ui.overlayDismissed = false;
    if (before && before.phase !== 'over' && game.phase === 'over') {
      sound(game.winner === game.you ? 'win' : 'lose');
    }
    if (game.phase !== 'playing' || !game.myTurn) {
      ui.selected = null;
      ui.hints = [];
    }

    var combat = (view.log || []).filter(function (l) { return l.type === 'combat'; }).length;
    if (combat > prevCombat && view.lastMove) {
      var to = R.parse(view.lastMove.to);
      Render.clash(to[0], to[1], '交锋');
    }
    prevCombat = combat;

    Render.render(game, ui);
  }

  /* ---------------- 棋盘交互 ---------------- */
  function onBoardClick(e) {
    if (!game || ui.busy) return;
    var c = cellFromEvent(e);
    if (!c) return;

    if (game.phase === 'setup') {
      var sp = game.board.get(c.key);
      if (!sp || sp.side !== ui.youSide || sp.hidden) return;
      if (!ui.selected) {
        ui.selected = c.key;
        sound('select');
        Render.render(game, ui);
        return;
      }
      if (ui.selected === c.key) {
        ui.selected = null;
        Render.render(game, ui);
        return;
      }
      var from = R.parse(ui.selected);
      ui.busy = true;
      ack('room:swap', { ax: from[0], ay: from[1], bx: c.x, by: c.y }).then(function (res) {
        ui.busy = false;
        ui.selected = null;
        if (!res.ok) {
          toast(res.error || '布阵调整失败', true);
          sound('error');
          Render.render(game, ui);
        } else {
          sound('swap');
        }
      });
      return;
    }

    if (game.phase !== 'playing' || !game.myTurn) return;

    var sel = ui.selected ? game.board.get(ui.selected) : null;
    if (sel) {
      var hit = ui.hints.some(function (h) {
        return h.x === c.x && h.y === c.y && h.type !== 'mark';
      });
      if (hit) {
        var f = R.parse(ui.selected);
        ui.busy = true;
        ack('game:move', { fx: f[0], fy: f[1], tx: c.x, ty: c.y }).then(function (res) {
          ui.busy = false;
          ui.selected = null;
          ui.hints = [];
          if (!res.ok) {
            toast(res.error || '走法被拒绝', true);
            sound('error');
            Render.render(game, ui);
          } else {
            sound(res.type && res.type !== 'move' ? 'clash' : 'move');
          }
        });
        return;
      }
    }

    var piece = game.board.get(c.key);
    if (piece && piece.side === ui.youSide && !piece.hidden) {
      if (ui.selected === c.key) {
        ui.selected = null;
        ui.hints = [];
      } else {
        ui.selected = c.key;
        ui.hints = R.destinations(game.board, c.key, {
          isEngineer: piece.name === '工兵'
        }).map(function (m) {
          return { x: m.x, y: m.y, type: m.capture ? 'cap' : '' };
        });
      }
      sound('select');
      Render.render(game, ui);
      return;
    }

    ui.selected = null;
    ui.hints = [];
    Render.render(game, ui);
  }

  /* ---------------- 工具栏 / 结算层 ---------------- */
  function onToolbarClick(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    var act = btn.getAttribute('data-act');

    if (act === 'ready') {
      ack('room:ready', {}).then(function (res) {
        if (!res.ok) { toast(res.error || '准备失败', true); sound('error'); }
        else sound('select');
      });
    } else if (act === 'resign') {
      ack('game:resign', {}).then(function (res) {
        if (!res.ok) toast(res.error || '认输失败', true);
      });
    } else if (act === 'rematch') {
      ui.overlayDismissed = false;
      ack('room:rematch', {}).then(function (res) {
        if (!res.ok) toast(res.error || '重开失败', true);
      });
    } else if (act === 'leave') {
      leaveRoom();
    }
  }

  function onOverlayClick(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    if (act === 'close') {
      ui.overlayDismissed = true;
      document.getElementById('overlay').classList.remove('is-on');
    } else if (act === 'again') {
      ui.overlayDismissed = false;
      ack('room:rematch', {});
    }
  }

  function leaveRoom() {
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
    currentCode = null;
    game = null;
    ui.selected = null;
    ui.hints = [];
    prevCombat = 0;
    root.JunqiEntry.show();
    toast('已离开房间');
  }

  /* ---------------- 启动 ---------------- */
  function start(opts) {
    key = getKey();

    if (!bound) {
      document.getElementById('board').addEventListener('click', onBoardClick);
      document.getElementById('toolbar').addEventListener('click', onToolbarClick);
      document.getElementById('overlay').addEventListener('click', onOverlayClick);
      document.getElementById('newGameBtn').addEventListener('click', function () {
        if (game) leaveRoom();
      });
      bound = true;
    }

    socket = io({ transports: ['websocket', 'polling'] });

    socket.on('connect', function () {
      var payload = { key: key, name: opts.name };
      var event = opts.mode === 'create' ? 'room:create' : 'room:join';
      if (opts.mode === 'join') payload.code = opts.code;
      if (currentCode) {
        // 自动重连：回到原房间，不另建新房间
        event = 'room:join';
        payload.code = currentCode;
      }

      socket.timeout(4000).emit(event, payload, function (err, res) {
        if (err || !res || !res.ok) {
          root.JunqiEntry.show();
          root.JunqiEntry.message((res && res.error) || '连接失败');
          return;
        }
        currentCode = res.code;
        root.JunqiEntry.message('');
        if (opts.mode === 'create' && !payload.reconnected) {
          toast('房号 ' + res.code + ' · 发给好友加入');
        }
      });
    });

    socket.on('state', applyView);
    socket.on('room:closed', function (p) {
      toast((p && p.reason) || '房间已关闭', true);
      leaveRoom();
    });
    socket.on('disconnect', function () {
      if (game) toast('与服务器断开，正在尝试重连…', true);
    });
  }

  root.JunqiOnline = { start: start, leave: leaveRoom };
})(typeof globalThis !== 'undefined' ? globalThis : this);
