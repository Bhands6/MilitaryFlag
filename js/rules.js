/*!
 * 军旗 · 陆战棋 —— 棋盘几何 / 走法 / 交战规则
 *
 * 坐标：x = 0..11 为纵深（0 为红方大本营一侧，11 为蓝方大本营一侧）
 *       y = 0..4  为横排（对应标准棋盘的 a..e 列）
 * 标准棋盘为 5 列 x 12 行，这里转置成 12 x 5，便于横屏摆放；
 * 几何与 samuelyuan/online-junqi 的 BoardConstants / Graph / RailroadNetwork 等价。
 */
(function (root) {
  'use strict';

  var ROWS = 12, COLS = 5;

  function key(x, y) { return x + ',' + y; }
  function parse(k) {
    var i = k.indexOf(',');
    return [Number(k.slice(0, i)), Number(k.slice(i + 1))];
  }
  function other(side) { return side === 'red' ? 'blue' : 'red'; }
  function sideName(side) { return side === 'red' ? '红方' : '蓝方'; }

  /* ---------------- 棋子表 ---------------- */
  // value 为 AI 估值，rank 用于比大小（炸弹/地雷/军旗另作特判）
  var ARMY = [
    ['司令', 1], ['军长', 1], ['师长', 2], ['旅长', 2], ['团长', 2], ['营长', 2],
    ['连长', 3], ['排长', 3], ['工兵', 3], ['炸弹', 2], ['地雷', 3], ['军旗', 1]
  ];

  var META = {
    '司令': { rank: 9, value: 100, note: '全盘最大，阵亡即亮旗' },
    '军长': { rank: 8, value: 86 },
    '师长': { rank: 7, value: 72 },
    '旅长': { rank: 6, value: 58 },
    '团长': { rank: 5, value: 46 },
    '营长': { rank: 4, value: 35 },
    '连长': { rank: 3, value: 26 },
    '排长': { rank: 2, value: 19 },
    '工兵': { rank: 1, value: 23, note: '唯一能挖雷，铁路上可任意转弯' },
    '炸弹': { rank: 0, value: 42, note: '与任何棋子同归于尽' },
    '地雷': { rank: -1, value: 30, note: '不可移动，仅工兵可破' },
    '军旗': { rank: -2, value: 100000, note: '被夺即败' }
  };

  var IMMOBILE = { '地雷': true, '军旗': true };
  function isMovableName(name) { return !IMMOBILE[name]; }

  function expandArmy() {
    var out = [];
    for (var i = 0; i < ARMY.length; i++) {
      for (var c = 0; c < ARMY[i][1]; c++) out.push(ARMY[i][0]);
    }
    return out;
  }

  /* ---------------- 地形 ---------------- */
  // 行营（八向相通，内部受保护）
  var CAMPS = ['2,1', '2,3', '3,2', '4,1', '4,3', '7,1', '7,3', '8,2', '9,1', '9,3'];
  // 大本营（入内不可再动）
  var HQS = ['0,1', '0,3', '11,1', '11,3'];

  function toSet(list) {
    var set = Object.create(null);
    for (var i = 0; i < list.length; i++) set[list[i]] = true;
    return set;
  }
  var CAMP_SET = toSet(CAMPS), HQ_SET = toSet(HQS);

  function sideOfCell(k) { return parse(k)[0] < 6 ? 'red' : 'blue'; }

  /* ---------------- 铁路 ---------------- */
  function lineBetween(x1, y1, x2, y2) {
    var out = [], dx = Math.sign(x2 - x1), dy = Math.sign(y2 - y1);
    var x = x1, y = y1;
    while (true) {
      out.push(key(x, y));
      if (x === x2 && y === y2) break;
      x += dx; y += dy;
    }
    return out;
  }

  // 8 段直线：两条纵贯铁路 + 双方各两排横贯铁路
  var RAIL_LINES = [
    lineBetween(1, 0, 5, 0),    // a2 - a6
    lineBetween(1, 4, 5, 4),    // e2 - e6
    lineBetween(6, 0, 10, 0),   // a7 - a11
    lineBetween(6, 4, 10, 4),   // e7 - e11
    lineBetween(1, 0, 1, 4),    // 第 2 行横贯
    lineBetween(5, 0, 5, 4),    // 第 6 行横贯（红方前线）
    lineBetween(6, 0, 6, 4),    // 第 7 行横贯（蓝方前线）
    lineBetween(10, 0, 10, 4)   // 第 11 行横贯
  ];

  var RAIL_SET = Object.create(null);
  for (var li = 0; li < RAIL_LINES.length; li++) {
    for (var lj = 0; lj < RAIL_LINES[li].length; lj++) RAIL_SET[RAIL_LINES[li][lj]] = true;
  }

  /* ---------------- 邻接图 ----------------
   * 1. 常规四向公路；但第 6 行与第 7 行（山界）只在 a / c / e 三处相接；
   * 2. 行营与其八个方向相邻格互通；
   * 3. 大本营只保留“进入”方向，走出去的边全部断开。
   */
  var ADJ = Object.create(null);

  (function buildGraph() {
    var i, j, k;
    for (i = 0; i < ROWS; i++) {
      for (j = 0; j < COLS; j++) ADJ[key(i, j)] = [];
    }
    function link(a, b) { ADJ[a].push(b); ADJ[b].push(a); }

    for (i = 0; i < ROWS; i++) {
      for (j = 0; j < COLS; j++) {
        if (i + 1 < ROWS) {
          var bridge = i === 5 ? (j === 0 || j === 2 || j === 4) : true;
          if (bridge) link(key(i, j), key(i + 1, j));
        }
        if (j + 1 < COLS) link(key(i, j), key(i, j + 1));
      }
    }

    for (var c = 0; c < CAMPS.length; c++) {
      var camp = CAMPS[c], p = parse(camp);
      for (var dx = -1; dx <= 1; dx++) {
        for (var dy = -1; dy <= 1; dy++) {
          if (!dx && !dy) continue;
          var nx = p[0] + dx, ny = p[1] + dy;
          if (nx < 0 || nx >= ROWS || ny < 0 || ny >= COLS) continue;
          var nk = key(nx, ny);
          if (ADJ[camp].indexOf(nk) < 0) link(camp, nk);
        }
      }
    }

    // 大本营只断掉“走出去”的方向，进入的边保留；否则棋子进得去出不来
    for (var h = 0; h < HQS.length; h++) {
      ADJ[HQS[h]] = [];
    }
  })();

  /* ---------------- 布阵 ---------------- */
  function canPlace(side, name, cell) {
    if (sideOfCell(cell) !== side) return false;
    var p = parse(cell), x = p[0];
    if (name === '军旗') return !!HQ_SET[cell];
    if (name === '地雷') return side === 'red' ? x <= 1 : x >= 10;
    if (name === '炸弹') return side === 'red' ? x < 5 : x > 6;
    return true;
  }

  function cellsOfSide(side) {
    var out = [];
    var from = side === 'red' ? 0 : 6, to = side === 'red' ? 5 : 11;
    for (var x = from; x <= to; x++) {
      for (var y = 0; y < COLS; y++) {
        var k = key(x, y);
        if (!CAMP_SET[k]) out.push(k);
      }
    }
    return out;
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /** 随机生成一方 25 枚棋子的布阵（返回 Map: cell -> name） */
  function randomDeploy(side) {
    var cells = cellsOfSide(side);
    var hqCells = cells.filter(function (k) { return !!HQ_SET[k]; });
    var flagCell = hqCells[Math.random() < 0.5 ? 0 : 1];

    var placed = Object.create(null);
    placed[flagCell] = '军旗';

    // 地雷：最后两列内随机，且至少一枚压在最末列
    var minePool = shuffle(cells.filter(function (k) {
      return !placed[k] && canPlace(side, '地雷', k);
    }));
    // 有较大概率在军旗正前方埋一颗，符合常见防守阵型
    var guard = key(side === 'red' ? 1 : 10, parse(flagCell)[1]);
    if (Math.random() < 0.65 && !placed[guard] && canPlace(side, '地雷', guard)) {
      minePool.unshift(guard);
    }
    var mines = [];
    var backline = minePool.filter(function (k) {
      return parse(k)[0] === (side === 'red' ? 0 : 11);
    });
    if (backline.length) mines.push(backline[0]);
    for (var m = 0; m < minePool.length && mines.length < 3; m++) {
      if (mines.indexOf(minePool[m]) < 0) mines.push(minePool[m]);
    }
    mines.slice(0, 3).forEach(function (k) { placed[k] = '地雷'; });

    // 炸弹：不能摆在最前一列，也不塞进大本营（进去就废了）
    var bombPool = shuffle(cells.filter(function (k) {
      return !placed[k] && !HQ_SET[k] && canPlace(side, '炸弹', k);
    }));
    bombPool.slice(0, 2).forEach(function (k) { placed[k] = '炸弹'; });

    var rest = expandArmy().filter(function (n) {
      return n !== '军旗' && n !== '地雷' && n !== '炸弹';
    });
    shuffle(rest);

    // 另一座大本营只放小棋子，别把主力锁死
    var spareHQ = hqCells.filter(function (k) { return !placed[k]; });
    if (spareHQ.length) {
      var idx = rest.indexOf('排长');
      if (idx < 0) idx = rest.indexOf('工兵');
      if (idx < 0) idx = 0;
      placed[spareHQ[0]] = rest.splice(idx, 1)[0];
    }

    var free = shuffle(cells.filter(function (k) { return !placed[k]; }));
    for (var f = 0; f < free.length; f++) placed[free[f]] = rest[f];

    var map = new Map();
    for (var c = 0; c < cells.length; c++) map.set(cells[c], placed[cells[c]]);
    return map;
  }

  /* ---------------- 走法 ---------------- */
  /**
   * 计算某枚棋子的全部可走位置。
   * board: Map<cell, piece>
   * opts.isEngineer: 覆盖工兵判定（AI 在信息不全时会用到）
   * opts.assumeMovable: 忽略“地雷/军旗不可动”，用于把暗棋当作普通棋子推演
   */
  function destinations(board, fromKey, opts) {
    opts = opts || {};
    var piece = board.get(fromKey);
    if (!piece) return [];
    if (!opts.assumeMovable && !isMovableName(piece.name)) return [];
    if (HQ_SET[fromKey]) return [];

    var side = piece.side;
    var isEngineer = opts.isEngineer != null ? opts.isEngineer : piece.name === '工兵';
    var out = [], seen = Object.create(null);

    function add(cell, capture, rail) {
      if (seen[cell]) return;
      seen[cell] = true;
      var p = parse(cell);
      out.push({ key: cell, x: p[0], y: p[1], capture: !!capture, rail: !!rail });
    }

    function visit(cell, rail) {
      var t = board.get(cell);
      if (!t) { add(cell, false, rail); return true; }
      if (t.side !== side && !CAMP_SET[cell]) add(cell, true, rail);
      return false;
    }

    // 公路一步（行营的八向斜线也在邻接表里）
    var adj = ADJ[fromKey] || [];
    for (var i = 0; i < adj.length; i++) visit(adj[i], false);

    // 铁路：直线任意步，遇子即停；工兵可任意转弯
    if (RAIL_SET[fromKey]) {
      var allowed = null;
      if (!isEngineer) {
        allowed = Object.create(null);
        for (var l = 0; l < RAIL_LINES.length; l++) {
          if (RAIL_LINES[l].indexOf(fromKey) >= 0) {
            for (var q = 0; q < RAIL_LINES[l].length; q++) allowed[RAIL_LINES[l][q]] = true;
          }
        }
      }
      var visited = Object.create(null);
      visited[fromKey] = true;
      var queue = [fromKey];
      while (queue.length) {
        var cur = queue.shift();
        var nb = ADJ[cur] || [];
        for (var j = 0; j < nb.length; j++) {
          var nk = nb[j];
          if (!RAIL_SET[nk] || visited[nk]) continue;
          if (allowed && !allowed[nk]) continue;
          visited[nk] = true;
          if (visit(nk, true)) queue.push(nk);
        }
      }
    }

    return out;
  }

  /* ---------------- 交战 ---------------- */
  /** 返回 flag / atk / def / both */
  function judge(atk, def) {
    if (def === '军旗') return 'flag';
    if (atk === '炸弹' || def === '炸弹') return 'both';
    if (def === '地雷') return atk === '工兵' ? 'atk' : 'def';
    if (atk === '地雷') return 'def';
    var ra = META[atk].rank, rd = META[def].rank;
    if (ra > rd) return 'atk';
    if (ra < rd) return 'def';
    return 'both';
  }

  function allCells() {
    var out = [];
    for (var x = 0; x < ROWS; x++) for (var y = 0; y < COLS; y++) out.push(key(x, y));
    return out;
  }

  root.JunqiRules = {
    ROWS: ROWS, COLS: COLS,
    ARMY: ARMY, META: META,
    CAMPS: CAMPS, HQS: HQS, CAMP_SET: CAMP_SET, HQ_SET: HQ_SET,
    RAIL_LINES: RAIL_LINES, RAIL_SET: RAIL_SET,
    ADJ: ADJ,
    key: key, parse: parse, other: other, sideName: sideName, sideOfCell: sideOfCell,
    isMovableName: isMovableName, expandArmy: expandArmy,
    canPlace: canPlace, cellsOfSide: cellsOfSide, randomDeploy: randomDeploy,
    destinations: destinations, judge: judge, allCells: allCells
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
