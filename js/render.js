/*!
 * 军旗 · 陆战棋 —— 棋盘绘制与界面同步
 * 只读 game / ui 状态，不修改对局逻辑。
 */
(function (root) {
  'use strict';

  var R = root.JunqiRules;
  var doc = document;
  var el = {};
  var pieceEls = new Map();
  var ready = false;

  function $(id) { return doc.getElementById(id); }

  function cx(i) { return 50 + i * 100; }
  function cy(j) { return 50 + j * 100; }
  function leftPct(x) { return (x * 100 / 12) + '%'; }
  function topPct(y) { return (y * 20) + '%'; }

  function octagon(x, y, r, attrs) {
    var pts = [];
    for (var i = 0; i < 8; i++) {
      var a = Math.PI / 8 + i * Math.PI / 4;
      pts.push((x + r * Math.cos(a)).toFixed(1) + ',' + (y + r * Math.sin(a)).toFixed(1));
    }
    return '<polygon points="' + pts.join(' ') + '" ' + attrs + '/>';
  }

  function star(x, y, outer, inner) {
    var pts = [];
    for (var i = 0; i < 10; i++) {
      var r = i % 2 ? inner : outer;
      var a = -Math.PI / 2 + i * Math.PI / 5;
      pts.push((x + r * Math.cos(a)).toFixed(1) + ',' + (y + r * Math.sin(a)).toFixed(1));
    }
    return '<polygon points="' + pts.join(' ') + '" fill="#B98A2E" stroke="#26221B" stroke-width="2"/>';
  }

  /* ---------------- 棋盘底图 ---------------- */
  function buildSvg() {
    var s = [];
    s.push('<defs>' +
      '<pattern id="grain" width="22" height="22" patternUnits="userSpaceOnUse">' +
      '<circle cx="3" cy="5" r=".8" fill="#8A7B57" opacity=".3"/>' +
      '<circle cx="14" cy="16" r=".7" fill="#8A7B57" opacity=".24"/>' +
      '<circle cx="19" cy="4" r=".55" fill="#8A7B57" opacity=".2"/>' +
      '<circle cx="8" cy="19" r=".5" fill="#22201A" opacity=".12"/>' +
      '</pattern>' +
      '<pattern id="mtn" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<path d="M0 0v8" stroke="#8A7B57" stroke-width="1" opacity=".35"/>' +
      '</pattern>' +
      '</defs>');

    s.push('<rect width="1200" height="500" fill="#E9DFC3"/>');
    s.push('<rect width="1200" height="500" fill="url(#grain)"/>');
    s.push('<rect x="0" y="0" width="600" height="500" fill="#C33F2C" opacity="0.05"/>');
    s.push('<rect x="600" y="0" width="600" height="500" fill="#2F5DA8" opacity="0.055"/>');

    // 山界（第 6 行与第 7 行之间）
    s.push('<rect x="589" y="0" width="22" height="500" fill="url(#mtn)" opacity=".5"/>');
    s.push('<line x1="600" y1="4" x2="600" y2="496" stroke="#8A7B57" stroke-width="2.2" stroke-dasharray="14 11"/>');

    // 公路（铁路另外画）
    var roads = [], seen = Object.create(null);
    R.allCells().forEach(function (cell) {
      var adj = R.ADJ[cell] || [];
      var a = R.parse(cell);
      for (var i = 0; i < adj.length; i++) {
        var nk = adj[i];
        if (R.RAIL_SET[cell] && R.RAIL_SET[nk]) continue;
        var pair = cell < nk ? cell + '|' + nk : nk + '|' + cell;
        if (seen[pair]) continue;
        seen[pair] = 1;
        var b = R.parse(nk);
        roads.push('<line x1="' + cx(a[0]) + '" y1="' + cy(a[1]) + '" x2="' + cx(b[0]) + '" y2="' + cy(b[1]) + '"/>');
      }
    });
    s.push('<g stroke="#C9B98F" stroke-width="2.4" stroke-linecap="round">' + roads.join('') + '</g>');

    // 铁路：双轨 + 枕木
    R.RAIL_LINES.forEach(function (line) {
      var a = R.parse(line[0]), b = R.parse(line[line.length - 1]);
      var x1 = cx(a[0]), y1 = cy(a[1]), x2 = cx(b[0]), y2 = cy(b[1]);
      s.push('<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#26221B" stroke-width="14"/>');
      s.push('<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#E9DFC3" stroke-width="5"/>');

      var horizontal = a[1] === b[1];
      var len = horizontal ? Math.abs(x2 - x1) : Math.abs(y2 - y1);
      var baseX = Math.min(x1, x2), baseY = Math.min(y1, y2);
      var ties = [];
      for (var d = 20; d < len; d += 26) {
        if (horizontal) ties.push('<line x1="' + (baseX + d) + '" y1="' + (y1 - 7) + '" x2="' + (baseX + d) + '" y2="' + (y1 + 7) + '"/>');
        else ties.push('<line x1="' + (x1 - 7) + '" y1="' + (baseY + d) + '" x2="' + (x1 + 7) + '" y2="' + (baseY + d) + '"/>');
      }
      s.push('<g stroke="#26221B" stroke-width="1.8" opacity=".9">' + ties.join('') + '</g>');
    });

    // 行营
    R.CAMPS.forEach(function (cell) {
      var p = R.parse(cell), x = cx(p[0]), y = cy(p[1]);
      s.push(octagon(x, y, 41, 'fill="#E2D5AE" stroke="#8A7B57" stroke-width="3.4"'));
      s.push(octagon(x, y, 31, 'fill="none" stroke="#8A7B57" stroke-width="1.3" opacity=".7"'));
      s.push('<circle cx="' + x + '" cy="' + y + '" r="3" fill="#8A7B57" opacity=".55"/>');
    });

    // 大本营
    R.HQS.forEach(function (cell) {
      var p = R.parse(cell), x = cx(p[0]), y = cy(p[1]);
      var col = p[0] === 0 ? '#C33F2C' : '#2F5DA8';
      s.push('<rect x="' + (x - 46) + '" y="' + (y - 46) + '" width="92" height="92" rx="12" fill="' + col + '" opacity=".1" stroke="' + col + '" stroke-width="2.6" stroke-dasharray="9 7"/>');
      s.push(star(x, y, 31, 13));
    });

    // 山界三处通道
    [0, 2, 4].forEach(function (j) {
      s.push('<g stroke="#8A7B57" stroke-width="2.6" stroke-linecap="round">' +
        '<line x1="576" y1="' + (cy(j) - 15) + '" x2="624" y2="' + (cy(j) - 15) + '"/>' +
        '<line x1="576" y1="' + (cy(j) + 15) + '" x2="624" y2="' + (cy(j) + 15) + '"/>' +
        '</g>');
    });

    s.push('<rect x="3" y="3" width="1194" height="494" rx="12" fill="none" stroke="#22201A" stroke-width="3" opacity=".82"/>');
    return s.join('');
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    el.board = $('board');
    el.svg = $('boardSvg');
    el.pieces = $('pieceLayer');
    el.hints = $('hintLayer');
    el.log = $('logList');
    el.logTag = $('logTag');
    el.toolbar = $('toolbar');
    el.overlay = $('overlay');
    el.ovKicker = $('ovKicker');
    el.ovTitle = $('ovTitle');
    el.ovNote = $('ovNote');
    el.ovStats = $('ovStats');
    el.roundNum = $('roundNum');
    el.phaseChip = $('phaseChip');
    el.levelChip = $('levelChip');
    el.turnChip = $('turnChip');
    el.turnText = $('turnText');
    el.stageNote = $('stageNote');
    el.redCount = $('redCount');
    el.blueCount = $('blueCount');
    el.meterRed = $('meterRed');
    el.meterBlue = $('meterBlue');
    el.redFlagChip = $('redFlagChip');
    el.blueFlagChip = $('blueFlagChip');
    el.redGrave = $('redGrave');
    el.blueGrave = $('blueGrave');
    el.aiName = $('aiName');

    el.svg.innerHTML = buildSvg();
    ready = true;
  }

  function clearPieces() {
    pieceEls.forEach(function (node) { node.remove(); });
    pieceEls.clear();
    el.hints.innerHTML = '';
  }

  /* ---------------- 渲染 ---------------- */
  function render(game, ui) {
    if (!ready) return;
    renderPieces(game, ui);
    renderHints(ui);
    renderHUD(game, ui);
    renderToolbar(game, ui);
    renderLog(game);
    renderGrave(game);
    renderOverlay(game, ui);
  }

  function renderPieces(game, ui) {
    var alive = Object.create(null);

    game.board.forEach(function (p, cell) {
      alive[p.id] = true;
      var node = pieceEls.get(p.id);
      var fresh = false;
      if (!node) {
        node = doc.createElement('div');
        node.innerHTML = '<div class="tok"></div>';
        el.pieces.appendChild(node);
        pieceEls.set(p.id, node);
        fresh = true;
      }
      var pos = R.parse(cell);
      node.style.left = leftPct(pos[0]);
      node.style.top = topPct(pos[1]);

      var hidden = !!p.hidden ||
        (p.side === 'blue' && !p.revealed && !(p.name === '军旗' && game.flagRevealed.blue));
      var cls = 'piece ' + p.side;
      if (hidden) cls += ' hidden';
      // 只在棋子公开时才用军旗配色，否则会从底色泄露旗位
      if (!hidden && p.name === '军旗') cls += ' flag';
      if (ui.selected === cell) cls += ' sel';
      if (fresh) cls += ' arrive';
      node.className = cls;
      if (fresh) {
        setTimeout(function () { node.classList.remove('arrive'); }, 420);
      }

      node.firstChild.textContent = hidden ? '？？' : p.name;
      node.title = hidden ? '蓝方 · 未知棋子' : (p.side === 'red' ? '红方 · ' : '蓝方 · ') + p.name;
    });

    var dead = [];
    pieceEls.forEach(function (node, id) {
      if (!alive[id]) dead.push(id);
    });
    dead.forEach(function (id) {
      var node = pieceEls.get(id);
      pieceEls.delete(id);
      node.classList.add('gone');
      setTimeout(function () { node.remove(); }, 340);
    });
  }

  function renderHints(ui) {
    var html = '';
    if (ui.lastMove) {
      [[ui.lastMove.from, ''], [ui.lastMove.to, ' to']].forEach(function (pair) {
        var p = R.parse(pair[0]);
        html += '<div class="marker' + pair[1] + '" style="left:' + leftPct(p[0]) + ';top:' + topPct(p[1]) + '"></div>';
      });
    }
    (ui.hints || []).forEach(function (h) {
      html += '<div class="hint-dot ' + (h.type || '') + '" style="left:' + leftPct(h.x) + ';top:' + topPct(h.y) + '"><i></i></div>';
    });
    el.hints.innerHTML = html;
  }

  function renderHUD(game, ui) {
    var red = 0, blue = 0;
    game.board.forEach(function (p) {
      if (p.side === 'red') red++; else blue++;
    });
    el.redCount.textContent = red;
    el.blueCount.textContent = blue;
    el.meterRed.style.width = (red / 50 * 100) + '%';
    el.meterBlue.style.width = (blue / 50 * 100) + '%';
    el.roundNum.textContent = game.round;

    el.redFlagChip.textContent = game.flagRevealed.red ? '红军旗 位置暴露' : '红军旗 未暴露';
    el.redFlagChip.classList.toggle('hot', game.flagRevealed.red);
    el.blueFlagChip.textContent = game.flagRevealed.blue ? '蓝军旗 位置暴露' : '蓝军旗 未暴露';
    el.blueFlagChip.classList.toggle('hot', game.flagRevealed.blue);

    var level = (root.JunqiAI && root.JunqiAI.levelOf(ui.level)) || { label: '老兵' };
    if (ui.mode === 'online') {
      el.levelChip.innerHTML = '对手 <b>玩家</b>';
      var foe = game.players && game.you ? game.players[game.you === 'red' ? 'blue' : 'red'] : null;
      el.aiName.textContent = foe
        ? (foe.name + (foe.connected ? ' / 联机中' : ' / 掉线'))
        : '等待对手加入';
    } else {
      el.levelChip.innerHTML = '对手 <b>' + level.label + '</b>';
      el.aiName.textContent = 'AI · ' + level.label + ' / 阵地右翼';
    }

    var phaseText = '布阵';
    var turnText = '布阵阶段 · 红方整备';
    if (game.phase === 'playing') {
      phaseText = '交战';
      turnText = ui.mode === 'online'
        ? (game.myTurn ? '轮到你行棋 · 请落子' : '等待对手行棋…')
        : (game.turn === 'red' ? '红方行棋 · 你先走' : '蓝方推演中 · 请稍候');
    } else if (game.phase === 'over') {
      phaseText = '终局';
      turnText = '对局结束 · ' + (game.winner ? (game.winner === 'red' ? '红方胜利' : '蓝方胜利') : '和棋');
    }
    el.phaseChip.innerHTML = '阶段 <b>' + phaseText + '</b>';
    el.turnText.textContent = turnText;
    el.turnChip.classList.toggle('blue-turn', game.phase !== 'setup' && game.turn === 'blue');

    if (game.phase === 'setup') {
      el.stageNote.textContent = ui.mode === 'online'
        ? '点击两枚己方棋子交换位置 · 摆好后点「准备开始」，双方就绪即开局'
        : '点击两枚己方棋子可交换位置 · 军旗须在大本营 · 地雷须在最后两列';
    } else if (game.phase === 'playing') {
      if (ui.mode === 'online' && !game.myTurn) {
        el.stageNote.textContent = '对手正在落子，请稍候…';
      } else if (ui.mode === 'solo' && game.turn === 'blue') {
        el.stageNote.textContent = '蓝方指挥部正在推演，请稍候…';
      } else if (ui.selected) {
        var sp = game.board.get(ui.selected);
        el.stageNote.textContent = sp
          ? '已选中「' + sp.name + '」· 亮点为可走位置，红圈为可攻击目标'
          : '点击己方棋子查看可走位置';
      } else {
        el.stageNote.textContent = '点击己方棋子查看可走位置 · 红圈为可吃目标 · 战报会公开交战双方身份';
      }
    } else {
      el.stageNote.textContent = '胜负已分 · ' + game.reason + ' · 可点「再来一局」重新布阵';
    }
  }

  function levelButtons(current) {
    var out = '';
    Object.keys(root.JunqiAI.LEVELS).forEach(function (key) {
      var lv = root.JunqiAI.LEVELS[key];
      out += '<button type="button" class="dg-btn' + (key === current ? ' on' : '') +
        '" data-act="level" data-level="' + key + '" title="' + lv.desc + '">' + lv.label + '</button>';
    });
    return out;
  }

  function renderToolbar(game, ui) {
    if (ui.mode === 'online') {
      var me = game.players && game.you ? game.players[game.you] : null;
      var foe = game.players && game.you ? game.players[game.you === 'red' ? 'blue' : 'red'] : null;
      var roomTag = '<span class="room-chip">房号 <b>' + (game.code || '----') + '</b></span>';
      var leave = '<button type="button" class="btn btn-ghost" data-act="leave">离开房间</button>';

      if (game.phase === 'setup') {
        var ready = !!(me && me.ready);
        var foeText = !foe ? '等待对手加入房间…'
          : (foe.connected ? ('对手：' + foe.name + (foe.ready ? '（已准备）' : '（布阵中）')) : '对手掉线，等待重连…');
        el.toolbar.innerHTML = roomTag +
          '<button type="button" class="btn ' + (ready ? 'btn-ghost' : 'btn-brass') + '" data-act="ready"' + (ready ? ' disabled' : '') + '>' +
          (ready ? '已准备 · 等待对手' : '准备开始') + '</button>' +
          '<span class="tool-note">' + foeText + '</span>' +
          '<span class="spacer"></span>' + leave;
      } else if (game.phase === 'playing') {
        el.toolbar.innerHTML = roomTag +
          '<span class="tool-note">' + (game.myTurn ? '轮到你行棋' : '等待对手行棋…') + '</span>' +
          '<span class="spacer"></span>' +
          '<button type="button" class="btn btn-ghost" data-act="resign">认输</button>' + leave;
      } else {
        var verdict = game.winner ? (game.winner === 'red' ? '红方获胜' : '蓝方获胜') : '和棋';
        el.toolbar.innerHTML = roomTag +
          '<button type="button" class="btn btn-red" data-act="rematch">再来一局</button>' +
          '<span class="spacer"></span>' +
          '<span class="tool-note">' + verdict + ' · ' + game.reason + '</span>' + leave;
      }
      return;
    }

    if (game.phase === 'setup') {
      el.toolbar.innerHTML =
        '<button type="button" class="btn btn-brass" data-act="shuffle">随机布阵</button>' +
        '<button type="button" class="btn btn-red" data-act="start">开始战斗</button>' +
        '<div class="dg" role="group" aria-label="对手难度">' + levelButtons(ui.level) + '</div>' +
        '<span class="spacer"></span>' +
        '<span class="tool-note">布阵完成后点「开始战斗」，红方先行</span>';
    } else if (game.phase === 'playing') {
      var locked = game.turn !== 'red' || ui.busy;
      el.toolbar.innerHTML =
        '<button type="button" class="btn btn-ghost" data-act="undo"' + (locked ? ' disabled' : '') + '>悔棋</button>' +
        '<button type="button" class="btn btn-ghost" data-act="hint"' + (locked ? ' disabled' : '') + '>参谋建议</button>' +
        '<button type="button" class="btn btn-ghost" data-act="resign">认输</button>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="btn btn-brass" data-act="reset">重开一局</button>';
    } else {
      var verdict = game.winner ? (game.winner === 'red' ? '红方获胜' : '蓝方获胜') : '和棋';
      el.toolbar.innerHTML =
        '<button type="button" class="btn btn-red" data-act="again">再来一局</button>' +
        '<button type="button" class="btn btn-ghost" data-act="reset">重新布阵</button>' +
        '<span class="spacer"></span>' +
        '<span class="tool-note">' + verdict + ' · ' + game.reason + '</span>';
    }
  }

  function renderLog(game) {
    el.log.innerHTML = game.log.map(function (it) {
      var no = 'R' + String(it.round).padStart(2, '0');
      return '<li class="log-item ' + it.type + '"><span class="log-no">' + no + '</span>' +
        '<div class="log-txt">' + it.html + '</div></li>';
    }).join('');
    el.log.scrollTop = el.log.scrollHeight;
    el.logTag.textContent = game.phase === 'over' ? 'END' : 'LIVE';
  }

  function renderGrave(game) {
    var red = [], blue = [];
    game.graveyard.forEach(function (p) {
      (p.side === 'red' ? red : blue).push(p);
    });
    el.redGrave.innerHTML = red.length
      ? red.map(function (p) { return '<span class="grave-chip rd">' + p.name + '</span>'; }).join('')
      : '<span class="grave-empty">—</span>';
    el.blueGrave.innerHTML = blue.length
      ? blue.map(function (p) { return '<span class="grave-chip bl">' + p.name + '</span>'; }).join('')
      : '<span class="grave-empty">—</span>';
  }

  function renderOverlay(game, ui) {
    var on = game.phase === 'over' && !ui.overlayDismissed;
    el.overlay.classList.toggle('is-on', on);
    if (!on) return;

    var win = game.winner === 'red';
    el.ovKicker.textContent = 'BATTLE REPORT · ROUND ' + game.round;
    el.ovTitle.textContent = game.winner ? (win ? '红方胜利' : '蓝方胜利') : '和棋';
    el.ovNote.textContent = game.reason + ' · 战报已归档';
    el.ovStats.innerHTML =
      '<span>回合 ' + game.round + '</span>' +
      '<span>交战 ' + game.stats.clashes + ' 次</span>' +
      '<span>红方战损 ' + game.stats.redLost + '</span>' +
      '<span>蓝方战损 ' + game.stats.blueLost + '</span>';
  }

  /* ---------------- 战斗气泡 ---------------- */
  function clash(x, y, text, bad) {
    var node = doc.createElement('div');
    node.className = 'clash' + (bad ? ' bad' : '');
    node.textContent = text;
    node.style.left = ((x + 0.5) * 100 / 12) + '%';
    node.style.top = ((y + 0.5) * 20) + '%';
    el.board.appendChild(node);
    setTimeout(function () { node.remove(); }, 1560);
  }

  root.JunqiRender = {
    init: init,
    render: render,
    clearPieces: clearPieces,
    clash: clash
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
