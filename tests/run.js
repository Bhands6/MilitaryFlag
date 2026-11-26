/*
 * 规则自测（零依赖）：node tests/run.js
 * 用 vm 加载浏览器端的三个纯逻辑脚本，逐条验证棋盘几何、走法、交战与对局流程。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = vm.createContext({ console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, Math: Math });
ctx.globalThis = ctx;

['rules', 'engine', 'ai'].forEach((name) => {
  const file = path.join(__dirname, '..', 'js', name + '.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: name + '.js' });
});

const R = ctx.JunqiRules;
const E = ctx.JunqiEngine;
const AI = ctx.JunqiAI;

let passed = 0;
const failures = [];

function ok(cond, label) {
  if (cond) passed++;
  else failures.push(label);
}

function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) passed++;
  else failures.push(label + '  (got ' + a + ', want ' + b + ')');
}

function boardFrom(pieces) {
  const map = new Map();
  let id = 0;
  Object.keys(pieces).forEach((cell) => {
    const value = pieces[cell];
    if (!value) return;
    map.set(cell, { id: 't' + (++id), name: value[0], side: value[1], revealed: false, moved: false });
  });
  return map;
}

function destKeys(board, cell, opts) {
  return R.destinations(board, cell, opts || {}).map((d) => d.key).sort();
}

/* ---------------- 1. 棋盘几何 ---------------- */
ok(R.ADJ['5,1'].indexOf('6,1') < 0, '山界 b 列不可越界');
ok(R.ADJ['5,3'].indexOf('6,3') < 0, '山界 d 列不可越界');
ok(R.ADJ['5,0'].indexOf('6,0') >= 0, '山界 a 列可越界');
ok(R.ADJ['5,2'].indexOf('6,2') >= 0, '山界 c 列可越界');
ok(R.ADJ['5,4'].indexOf('6,4') >= 0, '山界 e 列可越界');
eq(R.ADJ['0,1'].length, 0, '大本营不可走出');
ok(R.ADJ['1,1'].indexOf('0,1') >= 0, '大本营可进入');
eq(R.ADJ['2,1'].length, 8, '行营八向相通');
eq(R.ADJ['3,2'].length, 8, '中心行营八向相通');
eq(R.ADJ['1,0'].length, 4, '普通格四向相通');

/* ---------------- 2. 走法 ---------------- */
// 空棋子全盘，测试铁路
(function () {
  const b = boardFrom({ '1,0': ['排长', 'red'] });
  const d = destKeys(b, '1,0');
  ok(d.indexOf('5,0') >= 0, '铁路：a2 可直行到 a6');
  ok(d.indexOf('1,4') >= 0, '铁路：a2 可沿第 2 行到 e2');
  ok(d.indexOf('1,2') >= 0, '普通格可走一步');
  ok(d.indexOf('2,2') < 0, '非工兵不能在铁路上转弯离轨');
  ok(d.indexOf('3,1') < 0, '不可穿越山界以外的斜线');

  const eng = boardFrom({ '1,0': ['工兵', 'red'] });
  const de = destKeys(eng, '1,0');
  ok(de.indexOf('3,4') >= 0, '工兵可飞铁路转弯到 e4');
  ok(de.indexOf('5,4') >= 0, '工兵可沿铁路到 e6');
})();

// 阻挡：铁路上有子即停
(function () {
  const b = boardFrom({ '1,0': ['师长', 'red'], '3,0': ['排长', 'blue'] });
  const d = destKeys(b, '1,0');
  ok(d.indexOf('3,0') >= 0, '可吃铁路上挡路的敌子');
  ok(d.indexOf('4,0') < 0, '遇子不可越过');
})();

// 行营：可斜进斜出，营内受保护
(function () {
  const b = boardFrom({ '2,2': ['团长', 'red'], '3,3': ['司令', 'blue'] });
  const d = destKeys(b, '2,2');
  ok(d.indexOf('3,3') < 0, '非行营格之间不能斜走');
  ok(d.indexOf('2,1') >= 0, '可斜向进入行营');

  const b2 = boardFrom({ '2,1': ['排长', 'red'], '3,0': ['司令', 'blue'] });
  const d2 = destKeys(b2, '2,1');
  ok(d2.indexOf('3,0') >= 0, '营中棋子可斜向出击');
  ok(d2.indexOf('1,2') >= 0, '营中棋子可斜向走出');

  const b3 = boardFrom({ '1,1': ['司令', 'red'], '2,1': ['排长', 'blue'] });
  const d3 = destKeys(b3, '1,1');
  ok(d3.indexOf('2,1') < 0, '敌方行营内的棋子不可攻击');
})();

// 大本营与不可动棋子
(function () {
  const b = boardFrom({ '0,1': ['排长', 'red'], '11,1': ['军旗', 'blue'] });
  eq(destKeys(b, '0,1'), [], '大本营内棋子不可移动');
  const b2 = boardFrom({ '3,0': ['地雷', 'red'], '3,1': ['军旗', 'red'] });
  eq(destKeys(b2, '3,0'), [], '地雷不可移动');
  eq(destKeys(b2, '3,1'), [], '军旗不可移动');
})();

/* ---------------- 3. 交战判定 ---------------- */
eq(R.judge('司令', '军长'), 'atk', '司令吃军长');
eq(R.judge('军长', '司令'), 'def', '军长撞司令阵亡');
eq(R.judge('团长', '团长'), 'both', '同级同归于尽');
eq(R.judge('工兵', '地雷'), 'atk', '工兵挖雷');
eq(R.judge('排长', '地雷'), 'def', '排长踩雷');
eq(R.judge('炸弹', '司令'), 'both', '炸弹与司令同归于尽');
eq(R.judge('司令', '炸弹'), 'both', '司令碰炸弹同归于尽');
eq(R.judge('工兵', '军旗'), 'flag', '任何子可夺旗');
eq(R.judge('炸弹', '军旗'), 'flag', '炸弹碰旗也算夺旗');

/* ---------------- 4. 布阵约束 ---------------- */
(function () {
  let bad = 0;
  for (let t = 0; t < 300; t++) {
    ['red', 'blue'].forEach((side) => {
      const map = R.randomDeploy(side);
      if (map.size !== 25) { bad++; return; }
      const pool = {};
      R.expandArmy().forEach((n) => { pool[n] = (pool[n] || 0) + 1; });
      let flags = 0;
      map.forEach((name, cell) => {
        if (!pool[name]) { bad++; return; }
        pool[name]--;
        if (!R.canPlace(side, name, cell)) bad++;
        if (name === '军旗') flags++;
        if (R.CAMP_SET[cell]) bad++;
      });
      if (flags !== 1) bad++;
      Object.keys(pool).forEach((n) => { if (pool[n] !== 0) bad++; });
    });
  }
  ok(bad === 0, '300 次随机布阵全部合法（发现 ' + bad + ' 处违规）');
})();

/* ---------------- 5. 对局流程 ---------------- */
(function () {
  const g = new E.Game();
  eq(g.phase, 'setup', '初始为布阵阶段');
  eq(g.countOf('red'), 25, '红方 25 子');
  eq(g.countOf('blue'), 25, '蓝方 25 子');

  const redCells = [];
  g.board.forEach((p, cell) => { if (p.side === 'red') redCells.push(cell); });

  // 非法交换：把军旗换出大本营
  let flagCell = g.flagCellOf('red');
  const outside = redCells.find((c) => !R.HQ_SET[c]);
  ok(g.swap(flagCell, outside) === false, '军旗不能换出大本营');

  g.start();
  eq(g.phase, 'playing', '开始战斗');
  eq(g.turn, 'red', '红方先行');
  eq(g.round, 1, '第一回合');

  // 走一步再悔棋
  const moves = [];
  g.board.forEach((p, cell) => {
    if (p.side !== 'red') return;
    g.movesFrom(R.parse(cell)[0], R.parse(cell)[1]).forEach((m) => moves.push([cell, m.key]));
  });
  ok(moves.length > 0, '红方有合法走法');
  const before = g.countOf('red');
  const f = R.parse(moves[0][0]), t = R.parse(moves[0][1]);
  const ev = g.move(f[0], f[1], t[0], t[1]);
  ok(!!ev, '走子成功');
  eq(g.turn, 'blue', '走子后轮到蓝方');
  ok(g.move(f[0], f[1], t[0], t[1]) === null, '不能连走两步');
  ok(g.undo() === false, '蓝方回合不能悔棋');

  g.turn = 'red';
  ok(g.undo() === true, '红方回合可悔棋');
  eq(g.turn, 'red', '悔棋后仍为红方回合');
  eq(g.countOf('red'), before, '悔棋后棋子数复原');
})();

/* ---------------- 6. 随机自对弈 ---------------- */
(function () {
  let games = 0, maxPlies = 0, errors = 0;
  for (let t = 0; t < 40; t++) {
    const g = new E.Game();
    g.start();
    let plies = 0;
    while (g.phase === 'playing' && plies < 4000) {
      const side = g.turn;
      const all = [];
      g.board.forEach((p, cell) => {
        if (p.side !== side) return;
        const from = R.parse(cell);
        R.destinations(g.board, cell, { isEngineer: p.name === '工兵' }).forEach((d) => {
          all.push([from[0], from[1], d.x, d.y]);
        });
      });
      if (!all.length) { errors++; break; }
      const pick = all[Math.floor(Math.random() * all.length)];
      if (!g.move(pick[0], pick[1], pick[2], pick[3])) { errors++; break; }
      plies++;
    }
    if (g.phase !== 'over') errors++;
    games++;
    maxPlies = Math.max(maxPlies, plies);
  }
  eq(errors, 0, '40 局随机自对弈无异常（最长 ' + maxPlies + ' 手）');
})();

/* ---------------- 7. AI 对弈 ---------------- */
(function () {
  let errors = 0, wins = { red: 0, blue: 0 }, draws = 0, totalPlies = 0;
  const GAMES = 8;
  for (let t = 0; t < GAMES; t++) {
    const g = new E.Game();
    g.start();
    let plies = 0;
    while (g.phase === 'playing' && plies < 1200) {
      const side = g.turn;
      const mv = AI.choose(g, side, t % 2 ? 'hard' : 'normal');
      if (!mv) { errors++; break; }
      if (!g.move(mv.fx, mv.fy, mv.tx, mv.ty)) { errors++; break; }
      plies++;
    }
    if (g.phase !== 'over') errors++;
    else if (g.winner) wins[g.winner] = (wins[g.winner] || 0) + 1;
    else draws++;
    totalPlies += plies;
  }
  eq(errors, 0, GAMES + ' 局 AI 对弈全部正常结束');
  ok(wins.red + wins.blue + draws === GAMES, 'AI 对弈均给出结果（含和棋）');
  console.log('   AI 对弈统计：红 ' + wins.red + ' 胜 / 蓝 ' + wins.blue + ' 胜 / 和 ' + draws +
    '，平均 ' + (totalPlies / GAMES).toFixed(1) + ' 手');
})();

/* ---------------- 8. AI 不偷看暗棋 ---------------- */
(function () {
  function cloneGame(src) {
    const g = Object.create(E.Game.prototype);
    g.board = new Map();
    src.board.forEach((p, k) => g.board.set(k, Object.assign({}, p)));
    g.graveyard = src.graveyard.slice();
    g.turn = src.turn;
    g.phase = src.phase;
    g.round = src.round;
    g.flagRevealed = Object.assign({}, src.flagRevealed);
    g.lastMove = src.lastMove;
    g.history = [];
    return g;
  }

  const g = new E.Game();
  g.start();
  g.turn = 'blue';

  const hidden = [];
  g.board.forEach((p, cell) => {
    if (p.side === 'red' && !p.revealed) hidden.push(cell);
  });

  // 只交换两枚未亮明红子的身份，公开信息完全不变
  const g2 = cloneGame(g);
  const pa = g2.board.get(hidden[0]);
  const pb = g2.board.get(hidden[1]);
  const tmp = pa.name;
  pa.name = pb.name;
  pb.name = tmp;

  const originalRandom = ctx.Math.random;
  ctx.Math.random = () => 0.5;
  const m1 = AI.choose(g, 'blue', 'hard');
  const m2 = AI.choose(g2, 'blue', 'hard');
  ctx.Math.random = originalRandom;

  ok(m1 && m2 && m1.fromKey === m2.fromKey && m1.toKey === m2.toKey,
    '暗棋身份互换后 AI 决策不变（未偷看真实棋子）');
})();

/* ---------------- 汇总 ---------------- */
console.log('');
if (failures.length) {
  console.log('FAILED  ' + failures.length + ' / ' + (passed + failures.length));
  failures.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
} else {
  console.log('PASSED  ' + passed + ' 项检查');
}
