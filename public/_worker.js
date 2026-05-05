export class Room {
  constructor(state, env) {
    this.state = state;
    this.players = [];
    this.logs = [];
    this.currentRound = 1;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // WebSocket upgrade
    if (url.pathname === '/ws') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server);
      server.addEventListener('message', (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        this.handleMessage(server, msg);
      });
      server.addEventListener('close', () => {
        this.handleDisconnect(server);
      });
      return new Response(null, { status: 101, webSocket: client });
    }

    // Check if room exists (has been created)
    if (url.pathname === '/check') {
      return new Response(JSON.stringify({ exists: this.players.length > 0 }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not found', { status: 404 });
  }

  handleMessage(ws, msg) {
    switch (msg.type) {
      case 'create-room': {
        const name = msg.name;
        const roomId = this.state.id.name;
        this.players.push({ ws, name, score: 1000, originalScore: 1000, loans: 0 });
        ws.playerName = name;
        ws.send(JSON.stringify({ type: 'room-created', roomId }));
        this.broadcastRoomUpdate();
        break;
      }
      case 'join-room': {
        const { name } = msg;
        if (this.players.find(p => p.name === name)) {
          ws.send(JSON.stringify({ type: 'join-result', ok: false, msg: '该名称已被使用' }));
          return;
        }
        if (this.players.length === 0) {
          ws.send(JSON.stringify({ type: 'join-result', ok: false, msg: '房间不存在' }));
          return;
        }
        this.players.push({ ws, name, score: 1000, originalScore: 1000, loans: 0 });
        ws.playerName = name;
        ws.send(JSON.stringify({ type: 'join-result', ok: true }));
        this.broadcastRoomUpdate();
        break;
      }
      case 'bet': {
        const player = this.players.find(p => p.ws === ws);
        if (!player || msg.amount <= 0 || msg.amount > player.score) return;
        player.score -= msg.amount;
        this.logs.push({ type: 'bet', playerName: player.name, amount: msg.amount, round: this.currentRound, timestamp: Date.now() });
        this.broadcastRoomUpdate();
        break;
      }
      case 'take': {
        const player = this.players.find(p => p.ws === ws);
        if (!player || msg.amount <= 0) return;
        player.score += msg.amount;
        this.logs.push({ type: 'take', playerName: player.name, amount: msg.amount, round: this.currentRound, timestamp: Date.now() });
        this.broadcastRoomUpdate();
        break;
      }
      case 'loan': {
        const player = this.players.find(p => p.ws === ws);
        if (!player) return;
        player.score += 100;
        player.originalScore += 100;
        player.loans += 100;
        this.logs.push({ type: 'loan', playerName: player.name, amount: 100, round: this.currentRound, timestamp: Date.now() });
        this.broadcastRoomUpdate();
        break;
      }
      case 'new-round': {
        this.currentRound++;
        this.logs.push({ type: 'round', round: this.currentRound, timestamp: Date.now() });
        this.broadcastRoomUpdate();
        break;
      }
      case 'settle': {
        const result = this.players.map(p => ({
          name: p.name,
          originalScore: p.originalScore,
          currentScore: p.score,
          loans: p.loans,
          profit: p.score - p.originalScore
        }));
        this.broadcast({ type: 'settle-result', data: result });
        break;
      }
    }
  }

  handleDisconnect(ws) {
    const idx = this.players.findIndex(p => p.ws === ws);
    if (idx === -1) return;
    const player = this.players[idx];
    this.logs.push({ type: 'leave', playerName: player.name, round: this.currentRound, timestamp: Date.now() });
    this.players.splice(idx, 1);
    if (this.players.length === 0) {
      this.players = [];
      this.logs = [];
      this.currentRound = 1;
    } else {
      this.broadcastRoomUpdate();
    }
  }

  getRoomData() {
    let pot = 0;
    this.logs.forEach(log => {
      if (log.type === 'bet') pot -= log.amount;
      else if (log.type === 'take') pot += log.amount;
    });
    return {
      id: this.state.id.name,
      players: this.players.map(p => ({ name: p.name, score: p.score, originalScore: p.originalScore, loans: p.loans })),
      logs: this.logs,
      currentRound: this.currentRound,
      pot: -pot
    };
  }

  broadcastRoomUpdate() {
    this.broadcast({ type: 'room-update', data: this.getRoomData() });
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const player of this.players) {
      try { player.ws.send(data); } catch {}
    }
  }
}

function genRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API: generate a room ID (just returns a random ID, actual creation happens on WS connect)
    if (url.pathname === '/api/create-room') {
      const roomId = genRoomId();
      return new Response(JSON.stringify({ roomId }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // API: check room exists
    if (url.pathname === '/api/check-room') {
      const roomId = url.searchParams.get('room');
      if (!roomId) return new Response(JSON.stringify({ exists: false }), { headers: { 'Content-Type': 'application/json' } });
      const id = env.ROOM.idFromName(roomId);
      const stub = env.ROOM.get(id);
      const resp = await stub.fetch(new Request(new URL('/check', request.url)));
      return resp;
    }

    // API: WebSocket connection to a room's Durable Object
    if (url.pathname === '/api/ws') {
      const roomId = url.searchParams.get('room');
      if (!roomId) return new Response('Missing room', { status: 400 });
      const id = env.ROOM.idFromName(roomId);
      const stub = env.ROOM.get(id);
      // Rewrite URL path to /ws for the DO handler
      const newUrl = new URL(request.url);
      newUrl.pathname = '/ws';
      return stub.fetch(new Request(newUrl, request));
    }

    // Static files
    return env.ASSETS.fetch(request);
  }
};
