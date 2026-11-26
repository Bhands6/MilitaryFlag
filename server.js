/*!
 * 军旗 · 陆战棋 —— 房号制联机服务端
 *
 * node server.js              # 默认 3000 端口
 * PORT=3001 node server.js    # 自定义端口
 *
 * 房号：4 位数字。房主执红先行，加入者执蓝；双方布阵就绪后开局。
 * 服务端持有唯一权威棋盘，按身份下发不同视图（暗棋不泄露真实兵种）。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const { Game } = require('./js/engine.js');
const R = require('./js/rules.js');

const ROOT = __dirname;
const DISCONNECT_GRACE = 60000;   // 掉线后保留座位 60 秒
const CODE_RE = /^\d{4}$/;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

/** 内存房间表：code -> room */
const rooms = new Map();

function staticHandler(req, res) {
  let url = '/';
  try { url = decodeURIComponent((req.url || '/').split('?')[0]); } catch (_) { /* 保持默认 */ }
  if (url === '/') url = '/index.html';

  const file = path.normalize(path.join(ROOT, url));
  if (file.indexOf(ROOT) !== 0) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found: ' + url);
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

function newCode() {
  for (let i = 0; i < 200; i++) {
    const code = String(1000 + Math.floor(Math.random() * 9000));
    if (!rooms.has(code)) return code;
  }
  return null;
}

function makePlayer(key, name, socketId) {
  return { key: key, name: name, socketId: socketId, ready: false, connected: true };
}

function createRoom(code, key, name, socketId) {
  const room = {
    code: code,
    game: new Game(),
    players: {
      red: makePlayer(key, name, socketId),
      blue: null
    },
    timers: { red: null, blue: null }
  };
  rooms.set(code, room);
  return room;
}

/** 只下发该身份能看到的棋盘与战报 */
function viewFor(room, side) {
  const g = room.game;
  const board = [];

  g.board.forEach(function (p, cell) {
    const foeFlagKnown = p.name === '军旗' && !!g.flagRevealed[p.side];
    const hidden = p.side !== side && !p.revealed && !foeFlagKnown;
    board.push([cell, {
      id: p.id,
      side: p.side,
      name: hidden ? '？' : p.name,
      revealed: p.revealed,
      moved: p.moved,
      hidden: hidden
    }]);
  });

  const slot = function (s) {
    const p = room.players[s];
    return p ? { name: p.name, ready: p.ready, connected: p.connected } : null;
  };

  return {
    code: room.code,
    you: side,
    board: board,
    phase: g.phase,
    turn: g.turn,
    round: g.round,
    winner: g.winner,
    reason: g.reason,
    flagRevealed: { red: g.flagRevealed.red, blue: g.flagRevealed.blue },
    log: g.log.filter(function (it) { return !it.scope || it.scope === side; }),
    graveyard: g.graveyard,
    stats: g.stats,
    lastMove: g.lastMove,
    players: { red: slot('red'), blue: slot('blue') },
    myTurn: g.phase === 'playing' && g.turn === side
  };
}

function buildServer(port) {
  const server = http.createServer(staticHandler);
  const io = new Server(server, { pingInterval: 20000, pingTimeout: 15000 });

  function emitState(room) {
    ['red', 'blue'].forEach(function (side) {
      const p = room.players[side];
      if (p && p.connected && p.socketId) io.to(p.socketId).emit('state', viewFor(room, side));
    });
  }

  function roomOf(socket) {
    return socket.data && socket.data.code ? rooms.get(socket.data.code) : null;
  }

  function fail(ack, msg) {
    if (typeof ack === 'function') ack({ ok: false, error: msg });
  }

  function done(ack, extra) {
    if (typeof ack === 'function') ack(Object.assign({ ok: true }, extra || {}));
  }

  function clearTimer(room, side) {
    if (room.timers[side]) {
      clearTimeout(room.timers[side]);
      room.timers[side] = null;
    }
  }

  function onDisconnect(socket) {
    const room = roomOf(socket);
    if (!room) return;
    const side = socket.data.side;
    const player = room.players[side];
    if (!player || player.socketId !== socket.id) return;

    player.connected = false;
    player.socketId = null;
    clearTimer(room, side);

    // 另一家收到提示；给 60 秒重连窗口，超时判负或关闭房间
    room.timers[side] = setTimeout(function () {
      const still = room.players[side];
      if (still && still.connected) return;
      if (room.game.phase === 'playing') {
        room.game.endGame(R.other(side), R.sideName(side) + '掉线');
        emitState(room);
      } else {
        const other = R.other(side);
        const op = room.players[other];
        if (op && op.connected && op.socketId) io.to(op.socketId).emit('room:closed', { reason: '对手离开，房间已关闭' });
        rooms.delete(room.code);
      }
    }, DISCONNECT_GRACE);

    emitState(room);
  }

  io.on('connection', function (socket) {
    socket.on('room:create', function (payload, ack) {
      const key = payload && String(payload.key || '');
      const name = payload && String(payload.name || '').trim().slice(0, 12);
      if (!key || !name) return fail(ack, '请先填写昵称');

      const code = newCode();
      if (!code) return fail(ack, '房间已满，请稍后再试');

      const room = createRoom(code, key, name, socket.id);
      socket.data = { code: code, side: 'red', key: key };
      socket.join(code);
      done(ack, { code: code, side: 'red' });
      emitState(room);
    });

    socket.on('room:join', function (payload, ack) {
      const code = payload && String(payload.code || '').replace(/\D/g, '');
      const key = payload && String(payload.key || '');
      const name = payload && String(payload.name || '').trim().slice(0, 12);
      if (!CODE_RE.test(code)) return fail(ack, '请输入 4 位房号');
      if (!key || !name) return fail(ack, '请先填写昵称');

      const room = rooms.get(code);
      if (!room) return fail(ack, '房间不存在或已关闭');

      let side = null;
      // 同一 key 重连：回到原座位
      if (room.players.red && room.players.red.key === key) side = 'red';
      else if (room.players.blue && room.players.blue.key === key) side = 'blue';

      if (side) {
        const player = room.players[side];
        clearTimer(room, side);
        player.socketId = socket.id;
        player.connected = true;
        player.name = name;
      } else {
        if (room.players.blue) return fail(ack, '房间已满');
        if (room.game.phase !== 'setup') return fail(ack, '对局已经开始');
        side = 'blue';
        room.players.blue = makePlayer(key, name, socket.id);
        // 加入者需要在自己准备好后同步布阵视图
      }

      socket.data = { code: code, side: side, key: key };
      socket.join(code);
      done(ack, { code: code, side: side });
      emitState(room);
    });

    socket.on('room:swap', function (payload, ack) {
      const room = roomOf(socket);
      if (!room) return fail(ack, '不在房间中');
      const side = socket.data.side;
      if (room.game.phase !== 'setup') return fail(ack, '布阵已结束');
      const p = payload || {};
      if (!Number.isInteger(p.ax) || !Number.isInteger(p.ay) || !Number.isInteger(p.bx) || !Number.isInteger(p.by)) {
        return fail(ack, '坐标无效');
      }
      const a = R.key(p.ax, p.ay), b = R.key(p.bx, p.by);
      if (!room.game.swapSide(side, a, b)) return fail(ack, '该位置不符合布阵规则');
      done(ack);
      emitState(room);
    });

    socket.on('room:ready', function (payload, ack) {
      const room = roomOf(socket);
      if (!room || room.game.phase !== 'setup') return fail(ack, '当前不能准备');
      const player = room.players[socket.data.side];
      if (!player || player.key !== socket.data.key) return fail(ack, '身份校验失败');
      player.ready = true;
      if (room.players.red && room.players.blue &&
          room.players.red.ready && room.players.blue.ready &&
          room.players.red.connected && room.players.blue.connected) {
        room.game.start();
      }
      done(ack);
      emitState(room);
    });

    socket.on('game:move', function (payload, ack) {
      const room = roomOf(socket);
      if (!room) return fail(ack, '不在房间中');
      const g = room.game, side = socket.data.side;
      if (g.phase !== 'playing') return fail(ack, '对局未在进行中');
      if (g.turn !== side) return fail(ack, '还没轮到你');
      const p = payload || {};
      if (![p.fx, p.fy, p.tx, p.ty].every(Number.isInteger)) return fail(ack, '坐标无效');
      const ev = g.move(p.fx, p.fy, p.tx, p.ty);
      if (!ev) return fail(ack, '非法走法');
      done(ack, { type: ev.type });
      emitState(room);
    });

    socket.on('game:resign', function (payload, ack) {
      const room = roomOf(socket);
      if (!room || room.game.phase !== 'playing') return fail(ack, '当前不能认输');
      room.game.resignSide(socket.data.side);
      done(ack);
      emitState(room);
    });

    socket.on('room:rematch', function (payload, ack) {
      const room = roomOf(socket);
      if (!room || room.game.phase !== 'over') return fail(ack, '对局尚未结束');
      room.game.reset();
      if (room.players.red) room.players.red.ready = false;
      if (room.players.blue) room.players.blue.ready = false;
      done(ack);
      emitState(room);
    });

    socket.on('disconnect', function () { onDisconnect(socket); });
  });

  function close(cb) {
    rooms.forEach(function (room) {
      clearTimer(room, 'red');
      clearTimer(room, 'blue');
    });
    rooms.clear();
    io.close(function () { server.close(cb); });
  }

  return { server: server, io: io, rooms: rooms, close: close };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const app = buildServer(port);
  app.server.listen(port, '0.0.0.0', function () {
    console.log('军旗联机服务已启动  ->  http://localhost:' + port);
  });
}

module.exports = { buildServer: buildServer, rooms: rooms, viewFor: viewFor, createRoom: createRoom, newCode: newCode };
