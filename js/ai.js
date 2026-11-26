/*!
 * 军旗 · 陆战棋 —— 暗棋 AI
 *
 * 原则：只使用“公开信息”推演 —— 自己的棋子、已交锋亮明的棋子、阵亡名单，
 * 以及规则本身能推出的信息（军旗只能在大本营、地雷不会移动、动过的棋子
 * 不可能是地雷或军旗）。未亮明的敌子按剩余棋子池做加权期望值计算。
 */
(function (root) {
  'use strict';

  var R = root.JunqiRules;

  var LEVELS = {
    easy: { key: 'easy', label: '新兵', desc: '会漏算，适合熟悉规则', noise: 34, risk: 0.45, block: 0.35 },
    normal: { key: 'normal', label: '老兵', desc: '常规推演，攻守均衡', noise: 12, risk: 0.8, block: 1 },
    hard: { key: 'hard', label: '参谋', desc: '精算风险，抓旗意识强', noise: 2.5, risk: 1.05, block: 1.5 }
  };

  // 对方不一定真的会反击，风险按概率折算，避免 AI 过度保守
  var THREAT_PROB = 0.32;

  function isKnown(game, piece) {
    return !!piece.revealed || (piece.name === '军旗' && !!game.flagRevealed[piece.side]);
  }

  /** 剩余未知棋子池：全军 - 已亮明存活 - 已阵亡 */
  function buildBelief(game, side) {
    var foe = R.other(side);
    var counts = Object.create(null);
    for (var i = 0; i < R.ARMY.length; i++) counts[R.ARMY[i][0]] = R.ARMY[i][1];

    function consume(name) { if (counts[name] > 0) counts[name]--; }

    game.board.forEach(function (p) {
      if (p.side === foe && isKnown(game, p)) consume(p.name);
    });
    game.graveyard.forEach(function (p) {
      if (p.side === foe) consume(p.name);
    });

    var pool = [];
    Object.keys(counts).forEach(function (name) {
      for (var c = 0; c < counts[name]; c++) pool.push(name);
    });
    return { pool: pool, foe: foe };
  }

  function isBackTwoRows(cell, side) {
    var x = R.parse(cell)[0];
    return side === 'red' ? x <= 1 : x >= 10;
  }

  /**
   * 位置加权的候选身份：
   * - 军旗只能在己方大本营，别处的暗子不可能是军旗
   * - 地雷只在最后两列，且从未移动
   * - 大本营/后两列的暗子更可能是军旗/地雷，权重上调
   */
  function candidatePool(belief, piece, cell) {
    var inHQ = !!R.HQ_SET[cell];
    var back = isBackTwoRows(cell, piece.side);
    var names = [], weights = [], total = 0;

    for (var i = 0; i < belief.pool.length; i++) {
      var name = belief.pool[i];
      var w = 1;
      if (name === '军旗') {
        if (piece.moved || !inHQ) w = 0;
        else w = 5;
      } else if (name === '地雷') {
        if (piece.moved) w = 0;
        else if (back) w = 2.2;
      }
      if (w > 0) {
        names.push(name);
        weights.push(w);
        total += w;
      }
    }
    if (!total) {
      names = ['排长'];
      weights = [1];
      total = 1;
    }
    return { names: names, weights: weights, total: total };
  }

  /** 本轮交战的估值增量（从 AI 视角） */
  function outcomeDelta(atkName, defName) {
    var res = R.judge(atkName, defName);
    var va = R.META[atkName].value, vd = R.META[defName].value;
    if (res === 'flag') return 1e6;
    if (res === 'atk') return vd + 4;
    if (res === 'def') return -va;
    return vd - va;
  }

  function expectedAttack(game, atk, def, defCell, belief) {
    if (isKnown(game, def)) return outcomeDelta(atk.name, def.name);
    var pool = candidatePool(belief, def, defCell);
    var sum = 0;
    for (var i = 0; i < pool.names.length; i++) {
      sum += pool.weights[i] * outcomeDelta(atk.name, pool.names[i]);
    }
    return sum / pool.total;
  }

  /** 落点被反击的期望损失 */
  function expectedRisk(game, m, our, belief) {
    if (R.CAMP_SET[m.toKey]) return 0;
    var foe = R.other(our.side);
    var b = new Map(game.board);
    b.delete(m.fromKey);
    b.set(m.toKey, our);
    var risk = 0;

    b.forEach(function (rp, rk) {
      if (rp.side !== foe || rk === m.toKey) return;
      var known = isKnown(game, rp);
      var dests = R.destinations(b, rk, {
        isEngineer: known ? rp.name === '工兵' : false,
        assumeMovable: !known
      });
      var hit = false;
      for (var i = 0; i < dests.length; i++) {
        if (dests[i].key === m.toKey) { hit = true; break; }
      }
      if (!hit) return;

      if (known) {
        var res = R.judge(rp.name, our.name);
        if (res === 'atk') risk += R.META[our.name].value;
        else if (res === 'both') risk += Math.max(0, R.META[our.name].value - R.META[rp.name].value);
      } else {
        var pool = candidatePool(belief, rp, rk);
        var sum = 0;
        for (var j = 0; j < pool.names.length; j++) {
          var r2 = R.judge(pool.names[j], our.name);
          if (r2 === 'atk') sum += pool.weights[j] * R.META[our.name].value;
          else if (r2 === 'both') sum += pool.weights[j] * Math.max(0, R.META[our.name].value - R.META[pool.names[j]].value);
        }
        risk += sum / pool.total;
      }
    });
    return risk * THREAT_PROB;
  }

  function threatsToFlag(game, board, flag, foe) {
    var n = 0;
    board.forEach(function (p, cell) {
      if (p.side !== foe) return;
      var known = isKnown(game, p);
      var dests = R.destinations(board, cell, {
        isEngineer: known ? p.name === '工兵' : false,
        assumeMovable: !known
      });
      for (var i = 0; i < dests.length; i++) {
        if (dests[i].key === flag && dests[i].capture) { n++; break; }
      }
    });
    return n;
  }

  function collectMoves(game, side) {
    var moves = [];
    game.board.forEach(function (p, cell) {
      if (p.side !== side) return;
      var from = R.parse(cell);
      var dests = R.destinations(game.board, cell, { isEngineer: p.name === '工兵' });
      for (var i = 0; i < dests.length; i++) {
        moves.push({
          fromKey: cell, toKey: dests[i].key,
          fx: from[0], fy: from[1], tx: dests[i].x, ty: dests[i].y,
          capture: dests[i].capture
        });
      }
    });
    return moves;
  }

  function huntTargets(game, side) {
    var foe = R.other(side);
    // 只有军旗已暴露时才允许使用真实坐标，否则只能把两座大本营都当作候选
    if (game.flagRevealed[foe]) {
      var flag = game.flagCellOf(foe);
      if (flag) return [R.parse(flag)];
    }
    var out = [];
    R.HQS.forEach(function (cell) {
      if (R.sideOfCell(cell) === foe) out.push(R.parse(cell));
    });
    return out;
  }

  function minDist(x, y, targets) {
    var best = 99;
    for (var i = 0; i < targets.length; i++) {
      var d = Math.abs(x - targets[i][0]) + Math.abs(y - targets[i][1]);
      if (d < best) best = d;
    }
    return best;
  }

  function evaluate(game, m, ctx) {
    var piece = game.board.get(m.fromKey);
    var def = game.board.get(m.toKey);
    var score = 0;

    if (def) {
      score += expectedAttack(game, piece, def, m.toKey, ctx.belief);
      // 试探未知敌子本身有价值（亮明身份）
      if (!isKnown(game, def) && R.META[piece.name].value <= 35) score += 3.5;
    } else {
      var dir = ctx.side === 'red' ? 1 : -1;
      score += (m.tx - m.fx) * dir * ctx.aggression;
      if (ctx.side === 'red' ? m.tx >= 6 : m.tx <= 5) score += 2.4;
      if (R.RAIL_SET[m.toKey]) score += 1.3;
      if (R.CAMP_SET[m.toKey]) score += 1.4 + Math.min(2.4, R.META[piece.name].value / 45);
      if (R.CAMP_SET[m.fromKey]) score -= 0.7;
    }

    // 逼近敌方大本营（军旗已知就直扑军旗）
    score += (minDist(m.fx, m.fy, ctx.targets) - minDist(m.tx, m.ty, ctx.targets)) * ctx.hunt;

    // 主动寻找接触点，避免双方隔着山界互相观望
    var foes = 0, near = R.ADJ[m.toKey] || [];
    for (var i = 0; i < near.length; i++) {
      var t = game.board.get(near[i]);
      if (t && t.side === ctx.foe) foes++;
    }
    score += Math.min(6, foes * 2.2);

    score -= ctx.level.risk * expectedRisk(game, m, piece, ctx.belief);

    if (ctx.flag) {
      var b = new Map(game.board);
      b.delete(m.fromKey);
      b.set(m.toKey, piece);
      var after = threatsToFlag(game, b, ctx.flag, ctx.foe);
      score -= ctx.level.block * ((after - ctx.beforeThreats) * 30 + after * 8);
    }

    if (game.lastMove && m.fromKey === game.lastMove.to && m.toKey === game.lastMove.from) {
      score -= 6;
    }
    return score;
  }

  /**
   * 选择一步棋。side 通常为 'blue'，也可传 'red' 给“参谋建议”使用。
   */
  function choose(game, side, levelKey) {
    if (!game || game.phase !== 'playing' || game.turn !== side) return null;
    var level = LEVELS[levelKey] || LEVELS.normal;
    var moves = collectMoves(game, side);
    if (!moves.length) return null;

    var foe = R.other(side);
    var round = game.round || 1;
    var ctx = {
      side: side,
      foe: foe,
      level: level,
      belief: buildBelief(game, side),
      flag: game.flagCellOf(side),
      beforeThreats: 0,
      targets: huntTargets(game, side),
      // 回合越久越主动，避免双方在铁路口无限对峙
      aggression: 0.8 + Math.min(1.4, round / 40),
      hunt: 1.5 + Math.min(1.1, round / 55)
    };
    if (ctx.flag) ctx.beforeThreats = threatsToFlag(game, game.board, ctx.flag, foe);

    var best = null, bestScore = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var s = evaluate(game, moves[i], ctx) + (Math.random() - 0.5) * level.noise;
      if (s > bestScore) { bestScore = s; best = moves[i]; }
    }
    return best;
  }

  root.JunqiAI = {
    LEVELS: LEVELS,
    choose: choose,
    levelOf: function (key) { return LEVELS[key] || LEVELS.normal; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
