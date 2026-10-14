const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Fallback to index.html for room routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rooms storage
// Room structure:
// {
//   id: string,
//   hostId: string,
//   status: 'lobby' | 'playing' | 'gameover',
//   players: [ { id, name, color, isHost, isBot, isReady } ],
//   mapSize: 'small' | 'medium' | 'large',
//   turnTime: number,
//   gameState: { territories, currentTurnIndex, turnTimer, turnTimeoutId, round }
// }
const rooms = new Map();

const PLAYER_COLORS = [
  { name: 'Рубин', hex: '#EF4444', border: '#B91C1C', light: 'rgba(239, 68, 68, 0.25)' },
  { name: 'Сапфир', hex: '#3B82F6', border: '#1D4ED8', light: 'rgba(59, 130, 246, 0.25)' },
  { name: 'Изумруд', hex: '#10B981', border: '#047857', light: 'rgba(16, 185, 129, 0.25)' },
  { name: 'Янтарь', hex: '#F59E0B', border: '#B45309', light: 'rgba(245, 158, 11, 0.25)' },
  { name: 'Аметист', hex: '#8B5CF6', border: '#6D28D9', light: 'rgba(139, 92, 246, 0.25)' },
  { name: 'Кибер-Розовый', hex: '#EC4899', border: '#BE185D', light: 'rgba(236, 72, 153, 0.25)' }
];

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Map generation using Hexagon Grid
function generateMap(sizeType, activePlayers) {
  let cols = 6;
  let rows = 4;
  if (sizeType === 'small') {
    cols = 5;
    rows = 4; // ~20 hexes
  } else if (sizeType === 'large') {
    cols = 7;
    rows = 5; // ~35 hexes
  }

  const territories = [];
  let idCounter = 1;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Shape the map with an organic cutout (omit corners randomly or naturally)
      const isCorner = (r === 0 && (c === 0 || c === cols - 1)) || 
                       (r === rows - 1 && (c === 0 || c === cols - 1));
      if (isCorner && Math.random() < 0.6) continue;

      // Hex offset coordinate layout
      const xOffset = (r % 2 === 1) ? 0.5 : 0;
      const x = (c + xOffset) / cols + 0.08;
      const y = r / rows + 0.12;

      territories.push({
        id: idCounter++,
        col: c,
        row: r,
        x: Math.round(x * 1000) / 1000,
        y: Math.round(y * 1000) / 1000,
        dice: 1 + Math.floor(Math.random() * 2), // 1-2 starting dice
        owner: null, // neutral
        neighbors: []
      });
    }
  }

  // Calculate hex adjacency (offset grid)
  territories.forEach(t1 => {
    territories.forEach(t2 => {
      if (t1.id === t2.id) return;
      const dr = t2.row - t1.row;
      const dc = t2.col - t1.col;
      const rEven = (t1.row % 2 === 0);

      // In odd-r horizontal hex layout:
      // Even row neighbors: (0, -1), (0, 1), (-1, -1), (-1, 0), (1, -1), (1, 0)
      // Odd row neighbors:  (0, -1), (0, 1), (-1, 0), (-1, 1), (1, 0), (1, 1)
      let isNeighbor = false;
      if (dr === 0 && Math.abs(dc) === 1) isNeighbor = true;
      if (Math.abs(dr) === 1) {
        if (rEven) {
          if (dc === 0 || dc === -1) isNeighbor = true;
        } else {
          if (dc === 0 || dc === 1) isNeighbor = true;
        }
      }

      if (isNeighbor && !t1.neighbors.includes(t2.id)) {
        t1.neighbors.push(t2.id);
      }
    });
  });

  // Assign territories to players fairly
  const shuffledTerritories = [...territories].sort(() => Math.random() - 0.5);
  const territoriesPerPlayer = Math.max(2, Math.floor(territories.length / (activePlayers.length + 1)));

  let assignedCount = 0;
  activePlayers.forEach((player, pIdx) => {
    for (let i = 0; i < territoriesPerPlayer; i++) {
      if (assignedCount < shuffledTerritories.length) {
        const t = shuffledTerritories[assignedCount++];
        t.owner = player.id;
        t.dice = 2 + Math.floor(Math.random() * 2); // 2-3 dice starting power
      }
    }
  });

  // Rest remain neutral with 1-2 dice
  for (let i = assignedCount; i < shuffledTerritories.length; i++) {
    shuffledTerritories[i].owner = null;
    shuffledTerritories[i].dice = 1 + (Math.random() < 0.35 ? 1 : 0);
  }

  return territories;
}

// Calculate largest connected component for player reinforcements
function getLargestConnectedComponent(territories, playerId) {
  const playerTerritories = territories.filter(t => t.owner === playerId);
  if (playerTerritories.length === 0) return 0;

  const visited = new Set();
  let maxComponentSize = 0;

  playerTerritories.forEach(start => {
    if (visited.has(start.id)) return;
    let size = 0;
    const queue = [start];
    visited.add(start.id);

    while (queue.length > 0) {
      const current = queue.shift();
      size++;
      current.neighbors.forEach(nId => {
        const neighbor = playerTerritories.find(t => t.id === nId);
        if (neighbor && !visited.has(neighbor.id)) {
          visited.add(neighbor.id);
          queue.push(neighbor);
        }
      });
    }

    if (size > maxComponentSize) {
      maxComponentSize = size;
    }
  });

  return maxComponentSize;
}

// Distribute reinforcements
function grantReinforcements(room, playerId) {
  const territories = room.gameState.territories;
  const playerTerritories = territories.filter(t => t.owner === playerId);
  if (playerTerritories.length === 0) return 0;

  const connectedSize = getLargestConnectedComponent(territories, playerId);
  // Bonus = size of biggest connected territory (min 2, max 10)
  const bonusDice = Math.max(2, Math.min(10, connectedSize));

  let remainingDice = bonusDice;
  // Place reinforcements randomly on territories that have < 8 dice
  const eligible = [...playerTerritories].filter(t => t.dice < 8);
  
  while (remainingDice > 0 && eligible.some(t => t.dice < 8)) {
    const valid = eligible.filter(t => t.dice < 8);
    if (valid.length === 0) break;
    const chosen = valid[Math.floor(Math.random() * valid.length)];
    chosen.dice++;
    remainingDice--;
  }

  return bonusDice;
}

function checkGameOver(room) {
  const territories = room.gameState.territories;
  const alivePlayerIds = new Set(
    territories.filter(t => t.owner !== null).map(t => t.owner)
  );

  if (alivePlayerIds.size === 1) {
    const winnerId = [...alivePlayerIds][0];
    const winner = room.players.find(p => p.id === winnerId);
    room.status = 'gameover';
    clearTurnTimer(room);
    io.to(room.id).emit('gameOver', {
      winner: winner ? { id: winner.id, name: winner.name, color: winner.color } : null,
      stats: {
        totalRounds: room.gameState.round,
        territories: territories.length
      }
    });
    return true;
  }
  return false;
}

function clearTurnTimer(room) {
  if (room.gameState && room.gameState.turnTimeoutId) {
    clearTimeout(room.gameState.turnTimeoutId);
    room.gameState.turnTimeoutId = null;
  }
}

function startTurnTimer(room) {
  clearTurnTimer(room);
  const TIME_LIMIT = 40; // 40 seconds per turn
  room.gameState.turnTimer = TIME_LIMIT;

  const tickInterval = setInterval(() => {
    if (!room.gameState || room.status !== 'playing') {
      clearInterval(tickInterval);
      return;
    }
    room.gameState.turnTimer--;
    io.to(room.id).emit('timerTick', { secondsLeft: room.gameState.turnTimer });

    if (room.gameState.turnTimer <= 0) {
      clearInterval(tickInterval);
      nextTurn(room, true);
    }
  }, 1000);

  room.gameState.turnTimeoutId = tickInterval;
}

function nextTurn(room, timedOut = false) {
  if (room.status !== 'playing') return;
  clearTurnTimer(room);

  // Check if player won
  if (checkGameOver(room)) return;

  const territories = room.gameState.territories;
  const alivePlayers = room.players.filter(p => 
    territories.some(t => t.owner === p.id)
  );

  if (alivePlayers.length <= 1) {
    checkGameOver(room);
    return;
  }

  // Current player receives reinforcements before ending their turn
  const currentPlayer = room.players[room.gameState.currentTurnIndex];
  let gainedDice = 0;
  if (currentPlayer && territories.some(t => t.owner === currentPlayer.id)) {
    gainedDice = grantReinforcements(room, currentPlayer.id);
  }

  // Advance to next alive player
  let nextIdx = (room.gameState.currentTurnIndex + 1) % room.players.length;
  let attempts = 0;
  while (!territories.some(t => t.owner === room.players[nextIdx].id) && attempts < room.players.length) {
    nextIdx = (nextIdx + 1) % room.players.length;
    attempts++;
  }

  if (nextIdx <= room.gameState.currentTurnIndex) {
    room.gameState.round++;
  }

  room.gameState.currentTurnIndex = nextIdx;
  const nextPlayer = room.players[nextIdx];

  io.to(room.id).emit('turnChanged', {
    currentTurnIndex: nextIdx,
    currentTurnPlayerId: nextPlayer.id,
    currentTurnPlayerName: nextPlayer.name,
    round: room.gameState.round,
    previousPlayerReinforcements: gainedDice,
    territories: room.gameState.territories,
    timedOut
  });

  startTurnTimer(room);

  // If next player is Bot, run Bot AI
  if (nextPlayer.isBot) {
    runBotTurn(room, nextPlayer);
  }
}

// Bot AI - smart, fast, lightweight
function runBotTurn(room, botPlayer) {
  setTimeout(() => {
    if (room.status !== 'playing') return;
    if (room.players[room.gameState.currentTurnIndex]?.id !== botPlayer.id) return;

    const territories = room.gameState.territories;
    let botTerritories = territories.filter(t => t.owner === botPlayer.id && t.dice > 1);
    
    // Sort by dice descending
    botTerritories.sort((a, b) => b.dice - a.dice);

    let madeAttack = false;
    for (const source of botTerritories) {
      // Find weakest adjacent enemy or neutral territory
      const targetIds = source.neighbors;
      const targets = territories
        .filter(t => targetIds.includes(t.id) && t.owner !== botPlayer.id)
        .sort((a, b) => a.dice - b.dice);

      if (targets.length > 0) {
        const target = targets[0];
        // Attack if our dice > target dice or 50% chance if equal
        if (source.dice > target.dice || (source.dice === target.dice && Math.random() < 0.4)) {
          executeAttack(room, botPlayer.id, source.id, target.id);
          madeAttack = true;
          break;
        }
      }
    }

    // After attack, wait a bit and either attack again or end turn
    setTimeout(() => {
      if (room.status !== 'playing') return;
      if (room.players[room.gameState.currentTurnIndex]?.id !== botPlayer.id) return;

      if (madeAttack && Math.random() < 0.5) {
        // Maybe attack one more time
        runBotTurn(room, botPlayer);
      } else {
        nextTurn(room);
      }
    }, 1200);
  }, 1000);
}

function executeAttack(room, attackerId, fromId, toId) {
  const territories = room.gameState.territories;
  const source = territories.find(t => t.id === fromId);
  const target = territories.find(t => t.id === toId);

  if (!source || !target) return { success: false, reason: 'Invalid territory' };
  if (source.owner !== attackerId) return { success: false, reason: 'Not your territory' };
  if (target.owner === attackerId) return { success: false, reason: 'Cannot attack own territory' };
  if (source.dice <= 1) return { success: false, reason: 'Need at least 2 dice to attack' };
  if (!source.neighbors.includes(target.id)) return { success: false, reason: 'Territories not adjacent' };

  // Roll dice for attacker & defender
  const attackerRolls = [];
  let attackerSum = 0;
  for (let i = 0; i < source.dice; i++) {
    const roll = 1 + Math.floor(Math.random() * 6);
    attackerRolls.push(roll);
    attackerSum += roll;
  }

  const defenderRolls = [];
  let defenderSum = 0;
  for (let i = 0; i < target.dice; i++) {
    const roll = 1 + Math.floor(Math.random() * 6);
    defenderRolls.push(roll);
    defenderSum += roll;
  }

  const attackerWon = attackerSum > defenderSum;
  const prevTargetOwner = target.owner;

  if (attackerWon) {
    target.owner = attackerId;
    target.dice = source.dice - 1;
    source.dice = 1;
  } else {
    source.dice = 1;
  }

  const battleResult = {
    attackerId,
    fromId,
    toId,
    attackerWon,
    attackerSum,
    defenderSum,
    attackerRolls,
    defenderRolls,
    conquered: attackerWon,
    prevTargetOwner,
    territories: room.gameState.territories
  };

  io.to(room.id).emit('battleResolved', battleResult);

  // Check if player won the entire game
  checkGameOver(room);

  return { success: true, result: battleResult };
}

io.on('connection', (socket) => {
  let currentRoomId = null;

  // Create room
  socket.on('createRoom', ({ playerName, mapSize = 'medium' }) => {
    let roomId = generateRoomCode();
    while (rooms.has(roomId)) {
      roomId = generateRoomCode();
    }

    const player = {
      id: socket.id,
      name: (playerName || 'Игрок 1').trim().slice(0, 16),
      color: PLAYER_COLORS[0],
      isHost: true,
      isBot: false,
      isReady: true
    };

    const room = {
      id: roomId,
      hostId: socket.id,
      status: 'lobby',
      players: [player],
      mapSize: mapSize || 'medium',
      gameState: null
    };

    rooms.set(roomId, room);
    currentRoomId = roomId;
    socket.join(roomId);

    socket.emit('roomCreated', { room, playerId: socket.id });
  });

  // Join room
  socket.on('joinRoom', ({ roomId, playerName }) => {
    const cleanRoomId = (roomId || '').trim().toUpperCase();
    const room = rooms.get(cleanRoomId);

    if (!room) {
      socket.emit('errorMsg', 'Комната не найдена! Проверьте код комнаты.');
      return;
    }

    if (room.status !== 'lobby') {
      socket.emit('errorMsg', 'Игра в этой комнате уже началась!');
      return;
    }

    if (room.players.length >= 6) {
      socket.emit('errorMsg', 'В комнате уже максимум игроков (6)!');
      return;
    }

    // Assign color not yet taken
    const takenColors = room.players.map(p => p.color.hex);
    const availableColor = PLAYER_COLORS.find(c => !takenColors.includes(c.hex)) || PLAYER_COLORS[room.players.length % PLAYER_COLORS.length];

    const player = {
      id: socket.id,
      name: (playerName || `Игрок ${room.players.length + 1}`).trim().slice(0, 16),
      color: availableColor,
      isHost: false,
      isBot: false,
      isReady: true
    };

    room.players.push(player);
    currentRoomId = cleanRoomId;
    socket.join(cleanRoomId);

    socket.emit('roomJoined', { room, playerId: socket.id });
    io.to(cleanRoomId).emit('roomUpdated', room);
    io.to(cleanRoomId).emit('chatMessage', {
      sender: 'Система',
      text: `${player.name} присоединился к битве!`,
      isSystem: true
    });
  });

  // Add Bot
  socket.on('addBot', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.hostId !== socket.id || room.status !== 'lobby') return;
    if (room.players.length >= 6) {
      socket.emit('errorMsg', 'Максимум 6 игроков/ботов в комнате!');
      return;
    }

    const botNames = ['Бот-Титан', 'Бот-Генерал', 'Бот-Викинг', 'Бот-Киборг', 'Бот-Стратег'];
    const botIndex = room.players.filter(p => p.isBot).length;
    const name = botNames[botIndex % botNames.length];

    const takenColors = room.players.map(p => p.color.hex);
    const availableColor = PLAYER_COLORS.find(c => !takenColors.includes(c.hex)) || PLAYER_COLORS[room.players.length % PLAYER_COLORS.length];

    const botPlayer = {
      id: `bot_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      name: name,
      color: availableColor,
      isHost: false,
      isBot: true,
      isReady: true
    };

    room.players.push(botPlayer);
    io.to(currentRoomId).emit('roomUpdated', room);
  });

  // Remove Bot
  socket.on('removeBot', ({ botId }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.hostId !== socket.id || room.status !== 'lobby') return;
    room.players = room.players.filter(p => p.id !== botId);
    io.to(currentRoomId).emit('roomUpdated', room);
  });

  // Change player color
  socket.on('changeColor', ({ colorHex }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.status !== 'lobby') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const chosenColor = PLAYER_COLORS.find(c => c.hex === colorHex);
    if (chosenColor) {
      player.color = chosenColor;
      io.to(currentRoomId).emit('roomUpdated', room);
    }
  });

  // Change map size
  socket.on('changeMapSize', ({ mapSize }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.hostId !== socket.id || room.status !== 'lobby') return;
    if (['small', 'medium', 'large'].includes(mapSize)) {
      room.mapSize = mapSize;
      io.to(currentRoomId).emit('roomUpdated', room);
    }
  });

  // Start game
  socket.on('startGame', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.hostId !== socket.id || room.status !== 'lobby') return;

    if (room.players.length < 2) {
      socket.emit('errorMsg', 'Нужно минимум 2 игрока! Добавьте бота или отправьте ссылку другу.');
      return;
    }

    // Generate map
    const territories = generateMap(room.mapSize, room.players);

    // Randomize initial turn order
    room.players.sort(() => Math.random() - 0.5);

    room.status = 'playing';
    room.gameState = {
      territories,
      currentTurnIndex: 0,
      turnTimer: 40,
      turnTimeoutId: null,
      round: 1
    };

    io.to(currentRoomId).emit('gameStarted', {
      room,
      currentTurnPlayerId: room.players[0].id,
      currentTurnPlayerName: room.players[0].name
    });

    startTurnTimer(room);

    // If first player is bot, run bot
    if (room.players[0].isBot) {
      runBotTurn(room, room.players[0]);
    }
  });

  // Attack command
  socket.on('attack', ({ fromId, toId }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.status !== 'playing') return;

    const currentPlayer = room.players[room.gameState.currentTurnIndex];
    if (currentPlayer.id !== socket.id) {
      socket.emit('errorMsg', 'Сейчас не ваш ход!');
      return;
    }

    const res = executeAttack(room, socket.id, fromId, toId);
    if (!res.success) {
      socket.emit('errorMsg', res.reason);
    }
  });

  // End Turn command
  socket.on('endTurn', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.status !== 'playing') return;

    const currentPlayer = room.players[room.gameState.currentTurnIndex];
    if (currentPlayer.id !== socket.id) return;

    nextTurn(room);
  });

  // Restart Game
  socket.on('restartGame', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.hostId !== socket.id) return;

    clearTurnTimer(room);
    room.status = 'lobby';
    room.gameState = null;

    io.to(currentRoomId).emit('roomUpdated', room);
    io.to(currentRoomId).emit('gameRestarted');
  });

  // Reaction / Emoji
  socket.on('sendReaction', ({ emoji }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      io.to(currentRoomId).emit('reactionReceived', {
        playerId: player.id,
        playerName: player.name,
        emoji
      });
    }
  });

  // Chat message
  socket.on('sendChatMessage', ({ text }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player && text && text.trim().length > 0) {
      io.to(currentRoomId).emit('chatMessage', {
        sender: player.name,
        color: player.color.hex,
        text: text.trim().slice(0, 100)
      });
    }
  });

  // Disconnect handler
  socket.on('disconnect', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    const leavingPlayer = room.players.find(p => p.id === socket.id);
    if (!leavingPlayer) return;

    io.to(currentRoomId).emit('chatMessage', {
      sender: 'Система',
      text: `${leavingPlayer.name} покинул игру.`,
      isSystem: true
    });

    if (room.status === 'lobby') {
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        rooms.delete(currentRoomId);
      } else {
        if (room.hostId === socket.id) {
          room.hostId = room.players[0].id;
          room.players[0].isHost = true;
        }
        io.to(currentRoomId).emit('roomUpdated', room);
      }
    } else if (room.status === 'playing') {
      // If player leaves while playing, convert territories to neutral
      room.gameState.territories.forEach(t => {
        if (t.owner === socket.id) {
          t.owner = null;
        }
      });
      room.players = room.players.filter(p => p.id !== socket.id);

      if (room.players.filter(p => !p.isBot).length === 0) {
        clearTurnTimer(room);
        rooms.delete(currentRoomId);
      } else {
        checkGameOver(room);
        io.to(currentRoomId).emit('roomUpdated', room);
        io.to(currentRoomId).emit('territoriesUpdated', room.gameState.territories);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`⚔️ Territory Wars server is running on http://localhost:${PORT}`);
});
