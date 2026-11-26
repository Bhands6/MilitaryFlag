/*!
 * 军旗 · 陆战棋 —— 对局状态机
 * 负责布阵、走子结算、战报、悔棋、胜负判定，不接触 DOM。
 */
(function (root) {
  'use strict';

  var R = root.JunqiRules;

  function sideTag(side) {
    return '<b class="' + (side === 'red' ? 'rd' : 'bl') + '">' + R.sideName(side) + '</b>';
  }

  function Game() {
    this.reset();
  }

  Game.prototype.reset = function () {
    this.board = new Map();
    this.graveyard = [];
    this.turn = 'red';
    this.phase = 'setup';           // setup | playing | over
    this.round = 0;
    this.winner = null;
    this.reason = '';
    this.flagRevealed = { red: false, blue: false };
    this.log = [];
    this.history = [];
    this.lastMove = null;
    this.stats = { clashes: 0, redLost: 0, blueLost: 0 };
    this.peace = 0;
    this.uid = 0;

    this._deploy('red');
    this._deploy('blue');

    this.addLog('sys', '沙盘开启 · 双方各自布阵，暗棋对局');
    this.addLog('sys', '布阵规则：军旗居大本营 · 地雷守最后两列 · 炸弹不入最前列');
  };

  Game.prototype._deploy = function (side) {
    var map = R.randomDeploy(side);
    var self = this;
    map.forEach(function (name, cell) {
      self.board.set(cell, {
        id: 'p' + (++self.uid),
        name: name,
        side: side,
        revealed: false,
        moved: false
      });
    });
  };

  Game.prototype.addLog = function (type, html) {
    this.log.push({ type: type, html: html, round: this.round });
  };

  Game.prototype.pieceAt = function (cell) {
    return this.board.get(cell) || null;
  };

  Game.prototype.countOf = function (side) {
    var n = 0;
    this.board.forEach(function (p) { if (p.side === side) n++; });
    return n;
  };

  Game.prototype.movesFrom = function (x, y) {
    var cell = R.key(x, y);
    var piece = this.board.get(cell);
    if (!piece) return [];
    return R.destinations(this.board, cell, { isEngineer: piece.name === '工兵' });
  };

  Game.prototype.hasAnyMove = function (side) {
    var self = this;
    var found = false;
    this.board.forEach(function (p, cell) {
      if (found || p.side !== side) return;
      if (R.destinations(self.board, cell, { isEngineer: p.name === '工兵' }).length) found = true;
    });
    return found;
  };

  Game.prototype.flagCellOf = function (side) {
    var found = null;
    this.board.forEach(function (p, cell) {
      if (p.side === side && p.name === '军旗') found = cell;
    });
    return found;
  };

  /* ---------------- 布阵操作 ---------------- */
  Game.prototype.swap = function (a, b) {
    if (this.phase !== 'setup') return false;
    var pa = this.board.get(a), pb = this.board.get(b);
    if (!pa || !pb) return false;
    if (pa.side !== 'red' || pb.side !== 'red') return false;
    if (!R.canPlace('red', pa.name, b) || !R.canPlace('red', pb.name, a)) return false;

    this.board.set(a, pb);
    this.board.set(b, pa);
    this.addLog('sys', '红方调整阵型：<b>' + pa.name + '</b> ⇄ <b>' + pb.name + '</b>');
    return true;
  };

  Game.prototype.shuffleRed = function () {
    if (this.phase !== 'setup') return false;
    var self = this;
    this.board.forEach(function (p, cell) {
      if (p.side === 'red') self.board.delete(cell);
    });
    var map = R.randomDeploy('red');
    map.forEach(function (name, cell) {
      self.board.set(cell, {
        id: 'p' + (++self.uid),
        name: name,
        side: 'red',
        revealed: false,
        moved: false
      });
    });
    this.addLog('sys', '红方重新布阵完毕（随机阵型）');
    return true;
  };

  Game.prototype.start = function () {
    if (this.phase !== 'setup') return false;
    this.phase = 'playing';
    this.turn = 'red';
    this.round = 1;
    this.addLog('sys', '布阵结束，<b>红方先行</b>，对局开始');
    if (!this.hasAnyMove('red')) {
      this.endGame('blue', '红方无棋可走');
    }
    return true;
  };

  /* ---------------- 快照 / 悔棋 ---------------- */
  Game.prototype._snapshot = function () {
    var board = [];
    this.board.forEach(function (p, cell) {
      board.push([cell, { id: p.id, name: p.name, side: p.side, revealed: p.revealed, moved: p.moved }]);
    });
    this.history.push({
      board: board,
      graveyard: this.graveyard.map(function (p) { return { id: p.id, name: p.name, side: p.side }; }),
      turn: this.turn,
      phase: this.phase,
      round: this.round,
      winner: this.winner,
      reason: this.reason,
      flagRevealed: { red: this.flagRevealed.red, blue: this.flagRevealed.blue },
      logLen: this.log.length,
      lastMove: this.lastMove ? { from: this.lastMove.from, to: this.lastMove.to } : null,
      stats: { clashes: this.stats.clashes, redLost: this.stats.redLost, blueLost: this.stats.blueLost },
      peace: this.peace
    });
    if (this.history.length > 160) this.history.shift();
  };

  Game.prototype._restore = function (s) {
    var map = new Map();
    for (var i = 0; i < s.board.length; i++) {
      var p = s.board[i][1];
      map.set(s.board[i][0], { id: p.id, name: p.name, side: p.side, revealed: p.revealed, moved: p.moved });
    }
    this.board = map;
    this.graveyard = s.graveyard.map(function (p) { return { id: p.id, name: p.name, side: p.side }; });
    this.turn = s.turn;
    this.phase = s.phase;
    this.round = s.round;
    this.winner = s.winner;
    this.reason = s.reason;
    this.flagRevealed = { red: s.flagRevealed.red, blue: s.flagRevealed.blue };
    this.log = this.log.slice(0, s.logLen);
    this.lastMove = s.lastMove ? { from: s.lastMove.from, to: s.lastMove.to } : null;
    this.stats = { clashes: s.stats.clashes, redLost: s.stats.redLost, blueLost: s.stats.blueLost };
    this.peace = s.peace || 0;
  };

  /** 悔棋：回退到红方上一次行棋之前（连 AI 的那一步一起退） */
  Game.prototype.undo = function () {
    if (this.phase !== 'playing' || this.turn !== 'red') return false;
    if (!this.history.length) return false;
    var ok = false;
    while (this.history.length) {
      var s = this.history.pop();
      this._restore(s);
      if (s.turn === 'red') { ok = true; break; }
    }
    if (ok) this.addLog('sys', '红方悔棋，回退到上一回合');
    return ok;
  };

  /* ---------------- 走子 ---------------- */
  /**
   * 执行一步棋并结算，返回事件对象供界面播放动画：
   * { type:'move'|'atk'|'def'|'both'|'flag', from, to, atk:{name,side}, def:null|{name,side} }
   */
  Game.prototype.move = function (fx, fy, tx, ty) {
    if (this.phase !== 'playing') return null;
    var from = R.key(fx, fy), to = R.key(tx, ty);
    var piece = this.board.get(from);
    if (!piece || piece.side !== this.turn) return null;

    var dests = R.destinations(this.board, from, { isEngineer: piece.name === '工兵' });
    var legal = false;
    for (var i = 0; i < dests.length; i++) {
      if (dests[i].key === to) { legal = true; break; }
    }
    if (!legal) return null;

    this._snapshot();

    var def = this.board.get(to);
    piece.moved = true;
    this.board.delete(from);

    var ev = {
      type: 'move',
      from: from,
      to: to,
      atk: { name: piece.name, side: piece.side },
      def: null
    };

    if (!def) {
      this.board.set(to, piece);
      this.lastMove = { from: from, to: to };
    } else {
      ev.def = { name: def.name, side: def.side };
      piece.revealed = true;
      def.revealed = true;
      this.stats.clashes++;

      var res = R.judge(piece.name, def.name);
      ev.type = res;

      var atkLabel = sideTag(piece.side) + ' <b>' + piece.name + '</b>';
      var defLabel = sideTag(def.side) + ' <b>' + def.name + '</b>';
      var hint = '<span class="hl">';

      if (res === 'atk') {
        this._bury(def);
        this.board.delete(to);
        this.board.set(to, piece);
        this.addLog('combat', atkLabel + ' ✕ ' + defLabel + ' → ' + hint + '进攻方胜</span>');
      } else if (res === 'def') {
        this._bury(piece);
        this.addLog('combat', atkLabel + ' ✕ ' + defLabel + ' → ' + hint + '防守方胜</span>');
      } else if (res === 'both') {
        this._bury(piece);
        this._bury(def);
        this.board.delete(to);
        this.addLog('combat', atkLabel + ' ✕ ' + defLabel + ' → ' + hint + '同归于尽</span>');
      } else {
        // 夺旗
        this._bury(def);
        this.board.delete(to);
        if (piece.name === '炸弹') this._bury(piece);
        else this.board.set(to, piece);
        this.lastMove = { from: from, to: to };
        this.addLog('win', atkLabel + ' 攻入 ' + sideTag(def.side) + '大本营 → ' + hint + '夺取军旗</span>');
        this.endGame(piece.side, '夺取军旗');
        return ev;
      }
      this.lastMove = { from: from, to: to };
    }

    this.peace = def ? 0 : this.peace + 1;
    this._afterMove();
    return ev;
  };

  Game.prototype._bury = function (piece) {
    this.graveyard.push({ id: piece.id, name: piece.name, side: piece.side });
    this.stats[piece.side === 'red' ? 'redLost' : 'blueLost']++;
  };

  Game.prototype._afterMove = function () {
    // 司令阵亡 → 亮旗
    var self = this;
    ['red', 'blue'].forEach(function (side) {
      if (self.flagRevealed[side]) return;
      var dead = self.graveyard.some(function (p) {
        return p.side === side && p.name === '司令';
      });
      if (dead) {
        self.flagRevealed[side] = true;
        self.addLog('sys', sideTag(side) + ' 司令阵亡，<span class="hl">军旗位置暴露</span>');
      }
    });

    this.turn = R.other(this.turn);
    if (this.turn === 'red') this.round++;

    if (!this.hasAnyMove(this.turn)) {
      this.endGame(R.other(this.turn), R.sideName(this.turn) + '无棋可走');
      return;
    }

    // 久战无接触：避免双方在铁路口无限对峙
    if (this.peace >= 100) {
      this.endGame(null, '连续 50 回合无接触');
    }
  };

  Game.prototype.resign = function () {
    if (this.phase !== 'playing') return false;
    this.addLog('sys', '红方认输');
    this.endGame('blue', '红方认输');
    return true;
  };

  Game.prototype.endGame = function (winner, reason) {
    this.phase = 'over';
    this.winner = winner;
    this.reason = reason;
    this.addLog('win', winner
      ? '对局结束 · ' + sideTag(winner) + '获胜（' + reason + '）'
      : '对局结束 · <b>和棋</b>（' + reason + '）');
  };

  function coordLabel(cell) {
    var p = R.parse(cell);
    return '<span class="hl">' + String.fromCharCode(97 + p[1]) + (p[0] + 1) + '</span>';
  }

  root.JunqiEngine = { Game: Game, coordLabel: coordLabel };
})(typeof globalThis !== 'undefined' ? globalThis : this);
