const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const rooms = {};

function genRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

app.use(express.static('public'));

io.on('connection', (socket) => {
  let currentRoom = null;
  let playerName = null;

  socket.on('create-room', (name, cb) => {
    let roomId;
    do { roomId = genRoomId(); } while (rooms[roomId]);
    rooms[roomId] = {
      id: roomId,
      players: [],
      logs: [],
      currentRound: 1,
      createdAt: Date.now()
    };
    currentRoom = roomId;
    playerName = name;
    rooms[roomId].players.push({
      id: socket.id,
      name,
      score: 1000,
      originalScore: 1000,
      loans: 0,
      joinedAt: Date.now()
    });
    socket.join(roomId);
    cb(roomId);
    io.to(roomId).emit('room-update', getRoomData(roomId));
  });

  socket.on('check-room', (roomId, cb) => {
    cb(!!rooms[roomId]);
  });

  socket.on('join-room', ({ roomId, name }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb({ ok: false, msg: '房间不存在' });
    if (room.players.find(p => p.name === name)) return cb({ ok: false, msg: '该名称已被使用' });
    currentRoom = roomId;
    playerName = name;
    room.players.push({
      id: socket.id,
      name,
      score: 1000,
      originalScore: 1000,
      loans: 0,
      joinedAt: Date.now()
    });
    socket.join(roomId);
    cb({ ok: true });
    io.to(roomId).emit('room-update', getRoomData(roomId));
  });

  socket.on('bet', (amount) => {
    const room = rooms[currentRoom];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || amount <= 0 || amount > player.score) return;
    player.score -= amount;
    const log = { type: 'bet', playerName: player.name, amount, round: room.currentRound, timestamp: Date.now() };
    room.logs.push(log);
    io.to(currentRoom).emit('room-update', getRoomData(currentRoom));
  });

  socket.on('take', (amount) => {
    const room = rooms[currentRoom];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || amount <= 0) return;
    player.score += amount;
    const log = { type: 'take', playerName: player.name, amount, round: room.currentRound, timestamp: Date.now() };
    room.logs.push(log);
    io.to(currentRoom).emit('room-update', getRoomData(currentRoom));
  });

  socket.on('loan', () => {
    const room = rooms[currentRoom];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    player.score += 100;
    player.originalScore += 100;
    player.loans += 100;
    const log = { type: 'loan', playerName: player.name, amount: 100, round: room.currentRound, timestamp: Date.now() };
    room.logs.push(log);
    io.to(currentRoom).emit('room-update', getRoomData(currentRoom));
  });

  socket.on('new-round', () => {
    const room = rooms[currentRoom];
    if (!room) return;
    room.currentRound++;
    const log = { type: 'round', round: room.currentRound, timestamp: Date.now() };
    room.logs.push(log);
    io.to(currentRoom).emit('room-update', getRoomData(currentRoom));
  });

  socket.on('settle', () => {
    const room = rooms[currentRoom];
    if (!room) return;
    io.to(currentRoom).emit('settle-result', getSettlement(room));
  });

  socket.on('disconnect', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    const idx = room.players.findIndex(p => p.id === socket.id);
    if (idx === -1) return;
    const player = room.players[idx];
    room.logs.push({ type: 'leave', playerName: player.name, round: room.currentRound, timestamp: Date.now() });
    room.players.splice(idx, 1);
    if (room.players.length === 0) {
      delete rooms[currentRoom];
    } else {
      io.to(currentRoom).emit('room-update', getRoomData(currentRoom));
    }
  });
});

function getRoomData(roomId) {
  const room = rooms[roomId];
  if (!room) return null;
  let pot = 0;
  room.logs.forEach(log => {
    if (log.type === 'bet') pot -= log.amount;
    else if (log.type === 'take') pot += log.amount;
  });
  return {
    id: room.id,
    players: room.players.map(p => ({ name: p.name, score: p.score, originalScore: p.originalScore, loans: p.loans })),
    logs: room.logs,
    currentRound: room.currentRound,
    pot: -pot
  };
}

function getSettlement(room) {
  return room.players.map(p => ({
    name: p.name,
    originalScore: p.originalScore,
    currentScore: p.score,
    loans: p.loans,
    profit: p.score - p.originalScore
  }));
}

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
