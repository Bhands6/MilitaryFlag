/*!
 * 联机集成测试：node tests/online.test.js
 * 用两个 socket.io-client 模拟红蓝双方，跑房间、布阵、走子、认输、重开、重连全流程。
 */
'use strict';

const { io: connect } = require('socket.io-client');
const { buildServer } = require('../server.js');
const R = require('../js/rules.js');

let passed = 0;
const failures = [];
function ok(cond, label) {
  if (cond) passed++; else failures.push(label);
}

function emitAck(socket, event, payload) {
  return new Promise(function (resolve) {
    socket.timeout(3000).emit(event, payload || {}, function (err, res) {
      resolve(err ? { ok: false, error: String(err.message || err) } : res);
    });
  });
}

function waitFor(predicate, timeoutMs) {
  const limit = Date.now() + (timeoutMs || 3000);
  return new Promise(function (resolve, reject) {
    (function check() {
      if (predicate()) return resolve();
      if (Date.now() > limit) return reject(new Error('等待超时'));
      setTimeout(check, 15);
    })();
  });
}

function firstLegalMove(view) {
  const board = new Map(view.board);
  for (const [cell, piece] of board) {
    if (piece.side !== view.you || piece.hidden) continue;
    const from = R.parse(cell);
    const dests = R.destinations(board, cell, { isEngineer: piece.name === '工兵' });
    if (dests.length) {
      return { fx: from[0], fy: from[1], tx: dests[0].x, ty: dests[0].y };
    }
  }
  return null;
}

(async function main() {
  const app = buildServer(0);
  await new Promise(function (resolve) { app.server.listen(0, '127.0.0.1', resolve); });
  const port = app.server.address().port;
  const url = 'http://127.0.0.1:' + port;

  const a = connect(url, { forceNew: true, transports: ['websocket'] });
  const b = connect(url, { forceNew: true, transports: ['websocket'] });
  let stateA = null, stateB = null;
  a.on('state', function (s) { stateA = s; });
  b.on('state', function (s) { stateB = s; });

  try {
    await Promise.all([
      new Promise(function (r) { a.on('connect', r); }),
      new Promise(function (r) { b.on('connect', r); })
    ]);

    const created = await emitAck(a, 'room:create', { key: 'key-A', name: '阿红' });
    ok(created.ok && /^\d{4}$/.test(created.code) && created.side === 'red', '建房得到 4 位房号且执红');
    const code = created.code;

    const joined = await emitAck(b, 'room:join', { code: code, key: 'key-B', name: '小蓝' });
    ok(joined.ok && joined.side === 'blue', '凭房号加入并执蓝');

    const bad = await emitAck(b, 'room:join', { code: '0000', key: 'key-C', name: '路人' });
    ok(!bad.ok, '错误房号被拒绝');

    await waitFor(function () { return stateA && stateB && stateB.players.blue; });
    ok(stateA.you === 'red' && stateB.you === 'blue', '双方视图身份正确');

    // 暗棋隔离：红视角看不到蓝方真实兵种，蓝视角看不到红方真实兵种
    const blueHidden = stateA.board.filter(function (e) { return e[1].side === 'blue' && e[1].hidden; }).length;
    const redHidden = stateB.board.filter(function (e) { return e[1].side === 'red' && e[1].hidden; }).length;
    ok(blueHidden === 25 && redHidden === 25, '双方各看到对方 25 枚暗子');
    ok(stateA.board.filter(function (e) { return e[1].side === 'red' && !e[1].hidden; }).length === 25, '红方可见己方全部棋子');

    // 布阵交换
    const blueCells = [];
    stateB.board.forEach(function (e) { if (e[1].side === 'blue' && !e[1].hidden) blueCells.push(R.parse(e[0])); });
    const swapped = await emitAck(b, 'room:swap', {
      ax: blueCells[0][0], ay: blueCells[0][1], bx: blueCells[1][0], by: blueCells[1][1]
    });
    ok(swapped.ok, '蓝方可交换己方棋子');
    await waitFor(function () { return stateA.log.some(function (l) { return l.html.indexOf('蓝方调整阵型') >= 0; }) === false; });
    ok(!stateA.log.some(function (l) { return l.html.indexOf('蓝方调整阵型') >= 0; }), '红方看不到蓝方布阵调整记录');

    // 双方准备 → 开局
    await emitAck(a, 'room:ready', {});
    ok(stateA.phase === 'setup', '仅一方准备时不开局');
    await emitAck(b, 'room:ready', {});
    await waitFor(function () { return stateA.phase === 'playing' && stateB.phase === 'playing'; });
    ok(stateA.turn === 'red' && stateB.turn === 'red', '双方就绪后红方先行');

    // 红方走子
    const m1 = firstLegalMove(stateA);
    ok(!!m1, '红方有合法走法');
    const move1 = await emitAck(a, 'game:move', m1);
    ok(move1.ok, '服务端接受红方走子');
    await waitFor(function () { return stateA.turn === 'blue' && stateB.turn === 'blue'; });
    ok(stateB.myTurn === true && stateB.turn === 'blue' && stateA.myTurn === false, '走子后轮到蓝方');

    // 非法走子：红方抢走
    const illegal = await emitAck(a, 'game:move', m1);
    ok(!illegal.ok, '非回合方走子被拒绝');

    // 蓝方走子
    const m2 = firstLegalMove(stateB);
    ok(!!m2, '蓝方有合法走法');
    const move2 = await emitAck(b, 'game:move', m2);
    ok(move2.ok, '服务端接受蓝方走子');
    await waitFor(function () { return stateA.round === 2 && stateB.round === 2; });
    ok(stateA.round === 2 && stateB.round === 2, '一回合后进入第 2 回合');

    // 认输与重开
    await emitAck(b, 'game:resign', {});
    await waitFor(function () { return stateA.phase === 'over' && stateB.phase === 'over'; });
    ok(stateA.winner === 'red' && stateB.winner === 'red', '蓝方认输后红方获胜');

    await emitAck(a, 'room:rematch', {});
    await waitFor(function () { return stateA.phase === 'setup'; });
    ok(stateA.phase === 'setup' && !stateA.players.red.ready && !stateA.players.blue.ready, '重开回到布阵且清空准备状态');

    // 断线重连：同 key 回到原座位
    b.close();
    await waitFor(function () { return stateA.players.blue && !stateA.players.blue.connected; });
    ok(!stateA.players.blue.connected, '掉线后对方看到离线状态');

    const b2 = connect(url, { forceNew: true, transports: ['websocket'] });
    let stateB2 = null;
    b2.on('state', function (s) { stateB2 = s; });
    await new Promise(function (r) { b2.on('connect', r); });
    const rejoined = await emitAck(b2, 'room:join', { code: code, key: 'key-B', name: '小蓝' });
    ok(rejoined.ok && rejoined.side === 'blue', '同 key 重连回到蓝方座位');
    await waitFor(function () { return stateB2 && stateB2.board.length === 50; });
    ok(stateB2.you === 'blue' && stateB2.phase === 'setup', '重连后棋盘恢复');
    b2.close();

    console.log('');
    if (failures.length) {
      console.log('FAILED  ' + failures.length + ' / ' + (passed + failures.length));
      failures.forEach(function (f) { console.log('  ✗ ' + f); });
      process.exitCode = 1;
    } else {
      console.log('PASSED  ' + passed + ' 项联机检查');
    }
  } catch (e) {
    console.error('联机测试异常：', e);
    process.exitCode = 1;
  } finally {
    a.close();
    try { b.close(); } catch (_) { /* 已关闭 */ }
    await new Promise(function (r) { app.close(r); });
  }
})();
