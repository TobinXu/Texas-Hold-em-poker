export class Room {
  constructor(state, env) {
    this.state = state;
    this.players = [];
    this.logs = [];
    this.currentRound = 1;
    this.created = false;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // WebSocket upgrade
    if (url.pathname === '/ws') {
      if (!this.created) {
        this.created = (await this.state.storage.get('created')) === true;
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server);
      // Store name on the server socket for later use
      server.roomPlayerName = null;
      return new Response(null, { status: 101, webSocket: client });
    }

    // Check if room exists
    if (url.pathname === '/check') {
      if (!this.created) {
        this.created = (await this.state.storage.get('created')) === true;
      }
      return new Response(JSON.stringify({ exists: this.created }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not found', { status: 404 });
  }

  // Hibernation API: handle incoming WebSocket messages
  async webSocketMessage(ws, msg) {
    let data;
    try { data = JSON.parse(msg); } catch { return; }

    switch (data.type) {
      case 'create-room': {
        const name = data.name;
        this.players.push({ ws, name, score: 1000, originalScore: 1000, loans: 0 });
        ws.roomPlayerName = name;
        this.created = true;
        this.state.storage.put('created', true);
        const roomId = this.state.id.name;
        ws.send(JSON.stringify({ type: 'room-created', roomId }));
        this.broadcastRoomUpdate();
        break;
      }
      case 'join-room': {
        const { name } = data;
        if (!this.created) {
          ws.send(JSON.stringify({ type: 'join-result', ok: false, msg: '房间不存在' }));
          return;
        }
        if (this.players.find(p => p.ws === ws)) {
          ws.send(JSON.stringify({ type: 'join-result', ok: false, msg: '你已经加入了' }));
          return;
        }
        if (this.players.find(p => p.name === name)) {
          ws.send(JSON.stringify({ type: 'join-result', ok: false, msg: '该名称已被使用' }));
          return;
        }
        this.players.push({ ws, name, score: 1000, originalScore: 1000, loans: 0 });
        ws.roomPlayerName = name;
        ws.send(JSON.stringify({ type: 'join-result', ok: true }));
        this.broadcastRoomUpdate();
        break;
      }
      case 'bet': {
        const player = this.players.find(p => p.ws === ws);
        if (!player || data.amount <= 0 || data.amount > player.score) return;
        player.score -= data.amount;
        this.logs.push({ type: 'bet', playerName: player.name, amount: data.amount, round: this.currentRound, timestamp: Date.now() });
        this.broadcastRoomUpdate();
        break;
      }
      case 'take': {
        const player = this.players.find(p => p.ws === ws);
        if (!player || data.amount <= 0) return;
        player.score += data.amount;
        this.logs.push({ type: 'take', playerName: player.name, amount: data.amount, round: this.currentRound, timestamp: Date.now() });
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

  async webSocketClose(ws, code, reason) {
    const idx = this.players.findIndex(p => p.ws === ws);
    if (idx === -1) return;
    const player = this.players[idx];
    this.logs.push({ type: 'leave', playerName: player.name, round: this.currentRound, timestamp: Date.now() });
    this.players.splice(idx, 1);
    ws.close(code, reason);
    if (this.players.length === 0) {
      this.players = [];
      this.logs = [];
      this.currentRound = 1;
      this.created = false;
      this.state.storage.delete('created');
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
    const clients = this.state.getWebSockets();
    for (const client of clients) {
      try { client.send(data); } catch {}
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

    if (url.pathname === '/api/create-room') {
      const roomId = genRoomId();
      return new Response(JSON.stringify({ roomId }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/api/check-room') {
      const roomId = url.searchParams.get('room');
      if (!roomId) return new Response(JSON.stringify({ exists: false }), { headers: { 'Content-Type': 'application/json' } });
      const id = env.ROOM.idFromName(roomId);
      const stub = env.ROOM.get(id);
      const resp = await stub.fetch(new Request(new URL('/check', request.url)));
      return resp;
    }

    if (url.pathname === '/api/ws') {
      const roomId = url.searchParams.get('room');
      if (!roomId) return new Response('Missing room', { status: 400 });
      const id = env.ROOM.idFromName(roomId);
      const stub = env.ROOM.get(id);
      const newUrl = new URL(request.url);
      newUrl.pathname = '/ws';
      return stub.fetch(new Request(newUrl, request));
    }

    return env.ASSETS.fetch(request);
  }
};
