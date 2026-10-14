// ==========================================
// TERRITORY WARS — CLIENT LOGIC & ENGINE
// ==========================================

const socket = io();

// State variables
let myPlayerId = null;
let currentRoom = null;
let selectedTerritoryId = null;
let soundEnabled = true;
let isMyTurn = false;
let isLocalGame = false;
let localGameState = null;

// Audio Synthesizer (Zero external dependencies)
class SoundFX {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playTone(freq, type, duration, gainVal = 0.15) {
    if (!soundEnabled) return;
    this.init();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

      gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
      // Audio fallback
    }
  }

  click() {
    this.playTone(600, 'sine', 0.08, 0.08);
  }

  select() {
    this.playTone(880, 'sine', 0.12, 0.1);
  }

  turnChime() {
    if (!soundEnabled) return;
    this.init();
    if (!this.ctx) return;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      setTimeout(() => this.playTone(freq, 'triangle', 0.25, 0.12), i * 90);
    });
  }

  attackClash() {
    if (!soundEnabled) return;
    this.playTone(220, 'sawtooth', 0.25, 0.2);
    setTimeout(() => this.playTone(180, 'square', 0.3, 0.2), 60);
  }

  winBattle() {
    if (!soundEnabled) return;
    [440, 554.37, 659.25, 880].forEach((freq, i) => {
      setTimeout(() => this.playTone(freq, 'sine', 0.2, 0.12), i * 70);
    });
  }

  loseBattle() {
    if (!soundEnabled) return;
    [320, 260, 200].forEach((freq, i) => {
      setTimeout(() => this.playTone(freq, 'sawtooth', 0.25, 0.15), i * 100);
    });
  }

  victoryFanfare() {
    if (!soundEnabled) return;
    const notes = [523, 659, 783, 1046, 783, 1046];
    notes.forEach((freq, i) => {
      setTimeout(() => this.playTone(freq, 'triangle', 0.35, 0.2), i * 140);
    });
  }
}

const sfx = new SoundFX();

// DOM Elements
const screenMenu = document.getElementById('screenMenu');
const screenLobby = document.getElementById('screenLobby');
const screenGame = document.getElementById('screenGame');

const tabModeOnline = document.getElementById('tabModeOnline');
const tabModeLocal = document.getElementById('tabModeLocal');
const onlineModeContent = document.getElementById('onlineModeContent');
const localModeContent = document.getElementById('localModeContent');

const inviteBanner = document.getElementById('inviteBanner');
const inviteRoomCodeTag = document.getElementById('inviteRoomCodeTag');
const inviteNickInput = document.getElementById('inviteNickInput');
const btnDirectJoin = document.getElementById('btnDirectJoin');

const nicknameInput = document.getElementById('nicknameInput');
const roomCodeInput = document.getElementById('roomCodeInput');
const btnCreateRoom = document.getElementById('btnCreateRoom');
const btnJoinRoom = document.getElementById('btnJoinRoom');

const btnStartLocalGame = document.getElementById('btnStartLocalGame');
const hotseatPrompt = document.getElementById('hotseatPrompt');

const lobbyRoomCode = document.getElementById('lobbyRoomCode');
const playerCount = document.getElementById('playerCount');
const lobbyPlayersList = document.getElementById('lobbyPlayersList');
const colorPicker = document.getElementById('colorPicker');
const btnAddBot = document.getElementById('btnAddBot');
const btnStartGame = document.getElementById('btnStartGame');
const btnLeaveRoom = document.getElementById('btnLeaveRoom');
const btnCopyInvite = document.getElementById('btnCopyInvite');
const btnOpenSecondPlayer = document.getElementById('btnOpenSecondPlayer');
const qrCodeImg = document.getElementById('qrCodeImg');
const hostSettingsBlock = document.getElementById('hostSettingsBlock');
const guestWaitingNotice = document.getElementById('guestWaitingNotice');

const turnPlayerName = document.getElementById('turnPlayerName');
const turnIndicatorDot = document.getElementById('turnIndicatorDot');
const timerSeconds = document.getElementById('timerSeconds');
const roundNumber = document.getElementById('roundNumber');
const btnEndTurn = document.getElementById('btnEndTurn');
const gameMapSvg = document.getElementById('gameMapSvg');
const gamePlayersList = document.getElementById('gamePlayersList');
const battleLog = document.getElementById('battleLog');
const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');

const battleModal = document.getElementById('battleModal');
const gameOverModal = document.getElementById('gameOverModal');
const rulesModal = document.getElementById('rulesModal');
const toastEl = document.getElementById('toast');
const emojiContainer = document.getElementById('emoji-container');

// Sound Toggle
const soundToggleBtn = document.getElementById('soundToggleBtn');
soundToggleBtn.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  soundToggleBtn.textContent = soundEnabled ? '🔊' : '🔇';
  showToast(soundEnabled ? 'Звук включен' : 'Звук выключен');
});

// Rules Modal
document.getElementById('rulesBtn').addEventListener('click', () => rulesModal.classList.remove('hidden'));
document.getElementById('closeRulesBtn').addEventListener('click', () => rulesModal.classList.add('hidden'));
document.getElementById('btnGotRules').addEventListener('click', () => rulesModal.classList.add('hidden'));

// UI Screen Switching
function showScreen(screen) {
  [screenMenu, screenLobby, screenGame].forEach(s => s.classList.remove('active'));
  screen.classList.add('active');
}

// Toast
let toastTimeout = null;
function showToast(message) {
  clearTimeout(toastTimeout);
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  toastTimeout = setTimeout(() => {
    toastEl.classList.add('hidden');
  }, 3200);
}

// Mode Switching (Online vs Local Hotseat)
tabModeOnline.addEventListener('click', () => {
  sfx.click();
  tabModeOnline.classList.add('active');
  tabModeLocal.classList.remove('active');
  onlineModeContent.classList.add('active');
  localModeContent.classList.remove('active');
});

tabModeLocal.addEventListener('click', () => {
  sfx.click();
  tabModeLocal.classList.add('active');
  tabModeOnline.classList.remove('active');
  localModeContent.classList.add('active');
  onlineModeContent.classList.remove('active');
});

// Local player count buttons
document.querySelectorAll('.count-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    sfx.click();
    document.querySelectorAll('.count-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const count = parseInt(btn.dataset.count, 10);
    document.getElementById('localGroup3').classList.toggle('hidden', count < 3);
    document.getElementById('localGroup4').classList.toggle('hidden', count < 4);
  });
});

// Auto-detect invite parameter ?room=ABCD
let invitedRoomCode = null;
window.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    invitedRoomCode = roomParam.trim().toUpperCase();
    roomCodeInput.value = invitedRoomCode;
    inviteRoomCodeTag.textContent = invitedRoomCode;
    inviteBanner.classList.remove('hidden');
    showToast(`Вас пригласили в комнату ${invitedRoomCode}!`);
  }
});

btnDirectJoin.addEventListener('click', () => {
  sfx.click();
  const name = inviteNickInput.value.trim() || 'Игрок 2';
  if (invitedRoomCode) {
    socket.emit('joinRoom', { roomId: invitedRoomCode, playerName: name });
  }
});

// Available Colors
const AVAILABLE_COLORS = [
  { name: 'Рубин', hex: '#EF4444', border: '#B91C1C' },
  { name: 'Сапфир', hex: '#3B82F6', border: '#1D4ED8' },
  { name: 'Изумруд', hex: '#10B981', border: '#047857' },
  { name: 'Янтарь', hex: '#F59E0B', border: '#B45309' },
  { name: 'Аметист', hex: '#8B5CF6', border: '#6D28D9' },
  { name: 'Кибер-Розовый', hex: '#EC4899', border: '#BE185D' }
];

function renderColorPicker(selectedHex) {
  colorPicker.innerHTML = '';
  AVAILABLE_COLORS.forEach(c => {
    const opt = document.createElement('div');
    opt.className = `color-opt ${c.hex === selectedHex ? 'active' : ''}`;
    opt.style.backgroundColor = c.hex;
    opt.title = c.name;
    opt.addEventListener('click', () => {
      sfx.click();
      if (!isLocalGame) {
        socket.emit('changeColor', { colorHex: c.hex });
      }
    });
    colorPicker.appendChild(opt);
  });
}

// ------------------------------------------
// LOBBY ACTIONS (ONLINE)
// ------------------------------------------
btnCreateRoom.addEventListener('click', () => {
  sfx.click();
  isLocalGame = false;
  const name = nicknameInput.value.trim() || 'Командир';
  const activeSizeBtn = document.querySelector('.size-btn.active');
  const mapSize = activeSizeBtn ? activeSizeBtn.dataset.size : 'medium';
  socket.emit('createRoom', { playerName: name, mapSize });
});

btnJoinRoom.addEventListener('click', () => {
  sfx.click();
  isLocalGame = false;
  const code = roomCodeInput.value.trim().toUpperCase();
  const name = nicknameInput.value.trim() || 'Игрок';
  if (!code) {
    showToast('Введите код комнаты!');
    return;
  }
  socket.emit('joinRoom', { roomId: code, playerName: name });
});

btnCopyInvite.addEventListener('click', () => {
  sfx.click();
  const inviteUrl = `${window.location.origin}/?room=${currentRoom.id}`;
  navigator.clipboard.writeText(inviteUrl).then(() => {
    showToast('Ссылка скопирована! Отправьте её друзьям 🚀');
  }).catch(() => {
    prompt('Скопируйте ссылку на комнату:', inviteUrl);
  });
});

btnOpenSecondPlayer.addEventListener('click', () => {
  sfx.click();
  if (currentRoom) {
    const inviteUrl = `${window.location.origin}/?room=${currentRoom.id}`;
    window.open(inviteUrl, '_blank');
    showToast('Вторая вкладка открыта! Вы можете протестировать бой вдвоем.');
  }
});

btnAddBot.addEventListener('click', () => {
  sfx.click();
  socket.emit('addBot');
});

document.querySelectorAll('.size-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    sfx.click();
    document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    socket.emit('changeMapSize', { mapSize: btn.dataset.size });
  });
});

btnStartGame.addEventListener('click', () => {
  sfx.click();
  socket.emit('startGame');
});

btnLeaveRoom.addEventListener('click', () => {
  sfx.click();
  window.location.href = window.location.origin;
});

// Update Lobby UI
function updateLobbyUI(room) {
  currentRoom = room;
  lobbyRoomCode.textContent = room.id;
  playerCount.textContent = room.players.length;

  const me = room.players.find(p => p.id === myPlayerId);
  const isHost = me ? me.isHost : false;

  // Set QR code for instant smartphone join
  const inviteUrl = `${window.location.origin}/?room=${room.id}`;
  qrCodeImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(inviteUrl)}`;

  // Host vs Guest UI
  document.querySelectorAll('.host-only').forEach(el => {
    el.style.display = isHost ? 'block' : 'none';
  });
  guestWaitingNotice.classList.toggle('hidden', isHost);

  // Render players list
  lobbyPlayersList.innerHTML = '';
  room.players.forEach(p => {
    const card = document.createElement('div');
    card.className = 'player-card';

    const left = document.createElement('div');
    left.className = 'player-info-left';

    const dot = document.createElement('div');
    dot.className = 'player-color-dot';
    dot.style.backgroundColor = p.color.hex;
    dot.style.color = p.color.hex;

    const name = document.createElement('span');
    name.className = 'player-name-label';
    name.textContent = p.name + (p.id === myPlayerId ? ' (Вы)' : '');

    left.appendChild(dot);
    left.appendChild(name);

    const right = document.createElement('div');
    right.className = 'player-badges';

    if (p.isHost) {
      const hostBadge = document.createElement('span');
      hostBadge.className = 'badge-pill badge-host';
      hostBadge.textContent = 'Хост 👑';
      right.appendChild(hostBadge);
    }

    if (p.isBot) {
      const botBadge = document.createElement('span');
      botBadge.className = 'badge-pill badge-bot';
      botBadge.textContent = 'Бот 🤖';
      right.appendChild(botBadge);

      if (isHost) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-bot-btn';
        removeBtn.innerHTML = '&times;';
        removeBtn.title = 'Удалить бота';
        removeBtn.addEventListener('click', () => {
          socket.emit('removeBot', { botId: p.id });
        });
        right.appendChild(removeBtn);
      }
    }

    card.appendChild(left);
    card.appendChild(right);
    lobbyPlayersList.appendChild(card);
  });

  if (me) {
    renderColorPicker(me.color.hex);
  }

  if (room.mapSize) {
    document.querySelectorAll('.size-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.size === room.mapSize);
    });
  }
}

// ------------------------------------------
// LOCAL (HOTSEAT) MODE ENGINE
// ------------------------------------------
btnStartLocalGame.addEventListener('click', () => {
  sfx.click();
  isLocalGame = true;

  const activeBtn = document.querySelector('.count-btn.active');
  const count = parseInt(activeBtn ? activeBtn.dataset.count : 2, 10);

  const localPlayers = [];
  for (let i = 1; i <= count; i++) {
    const nameInput = document.getElementById(`localName${i}`);
    const name = (nameInput ? nameInput.value.trim() : '') || `Игрок ${i}`;
    localPlayers.push({
      id: `local_p_${i}`,
      name: name,
      color: AVAILABLE_COLORS[(i - 1) % AVAILABLE_COLORS.length],
      isHost: (i === 1),
      isBot: false
    });
  }

  // Generate Map locally
  const territories = generateLocalMap('medium', localPlayers);

  currentRoom = {
    id: 'LOCAL',
    status: 'playing',
    players: localPlayers,
    gameState: {
      territories,
      currentTurnIndex: 0,
      round: 1
    }
  };

  showScreen(screenGame);
  hotseatPrompt.classList.remove('hidden');
  updateGameUI(currentRoom);
  showToast(`⚔️ Битва на одном экране началась! Ход: ${localPlayers[0].name}`);
  sfx.turnChime();
});

function generateLocalMap(sizeType, activePlayers) {
  let cols = 6;
  let rows = 4;
  const territories = [];
  let idCounter = 1;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const isCorner = (r === 0 && (c === 0 || c === cols - 1)) || 
                       (r === rows - 1 && (c === 0 || c === cols - 1));
      if (isCorner && Math.random() < 0.6) continue;

      const xOffset = (r % 2 === 1) ? 0.5 : 0;
      const x = (c + xOffset) / cols + 0.08;
      const y = r / rows + 0.12;

      territories.push({
        id: idCounter++,
        col: c,
        row: r,
        x: Math.round(x * 1000) / 1000,
        y: Math.round(y * 1000) / 1000,
        dice: 1 + Math.floor(Math.random() * 2),
        owner: null,
        neighbors: []
      });
    }
  }

  territories.forEach(t1 => {
    territories.forEach(t2 => {
      if (t1.id === t2.id) return;
      const dr = t2.row - t1.row;
      const dc = t2.col - t1.col;
      const rEven = (t1.row % 2 === 0);

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

  const shuffled = [...territories].sort(() => Math.random() - 0.5);
  const perPlayer = Math.max(2, Math.floor(territories.length / (activePlayers.length + 1)));

  let assigned = 0;
  activePlayers.forEach(p => {
    for (let i = 0; i < perPlayer; i++) {
      if (assigned < shuffled.length) {
        const t = shuffled[assigned++];
        t.owner = p.id;
        t.dice = 2 + Math.floor(Math.random() * 2);
      }
    }
  });

  return territories;
}

// ------------------------------------------
// GAMEPLAY RENDERING (HEXAGON SVG MAP)
// ------------------------------------------
function getHexPoints(cx, cy, radius) {
  const points = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    const px = cx + radius * Math.cos(angle);
    const py = cy + radius * Math.sin(angle);
    points.push(`${Math.round(px)},${Math.round(py)}`);
  }
  return points.join(' ');
}

function renderMap() {
  if (!currentRoom || !currentRoom.gameState) return;

  const territories = currentRoom.gameState.territories;
  gameMapSvg.innerHTML = '';

  const SVG_WIDTH = 1000;
  const SVG_HEIGHT = 650;
  const HEX_RADIUS = 52;

  const activePlayer = currentRoom.players[currentRoom.gameState.currentTurnIndex];
  const activePlayerId = isLocalGame ? (activePlayer ? activePlayer.id : null) : myPlayerId;

  const selectedTerritory = selectedTerritoryId ? territories.find(t => t.id === selectedTerritoryId) : null;
  const validTargets = selectedTerritory ? selectedTerritory.neighbors : [];

  const sortedTerritories = [...territories].sort((a, b) => {
    if (a.id === selectedTerritoryId) return 1;
    if (b.id === selectedTerritoryId) return -1;
    return 0;
  });

  sortedTerritories.forEach(t => {
    const cx = t.x * (SVG_WIDTH - 160) + 80;
    const cy = t.y * (SVG_HEIGHT - 160) + 80;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'territory-group');
    g.dataset.id = t.id;

    let fillColor = '#1E293B';
    let strokeColor = '#334155';
    let isOwnerActive = false;

    if (t.owner) {
      const owner = currentRoom.players.find(p => p.id === t.owner);
      if (owner) {
        fillColor = owner.color.hex;
        strokeColor = owner.color.border || '#FFFFFF';
        if (owner.id === activePlayerId) isOwnerActive = true;
      }
    }

    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute('points', getHexPoints(cx, cy, HEX_RADIUS));
    polygon.setAttribute('fill', fillColor);
    polygon.setAttribute('stroke', strokeColor);

    let classes = ['hex-cell'];
    if ((isMyTurn || isLocalGame) && isOwnerActive && t.dice > 1) {
      classes.push('selectable');
    }
    if (t.id === selectedTerritoryId) {
      classes.push('selected');
    }
    if (selectedTerritory && validTargets.includes(t.id) && t.owner !== activePlayerId) {
      classes.push('attack-target');
    }

    polygon.setAttribute('class', classes.join(' '));

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', cx);
    text.setAttribute('y', cy + 1);
    text.setAttribute('class', 'hex-label');
    text.textContent = t.dice;

    const diceIcon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    diceIcon.setAttribute('x', cx);
    diceIcon.setAttribute('y', cy - 18);
    diceIcon.setAttribute('class', 'hex-dice-icon');
    diceIcon.setAttribute('text-anchor', 'middle');
    diceIcon.textContent = '🎲';

    g.appendChild(polygon);
    g.appendChild(diceIcon);
    g.appendChild(text);

    g.addEventListener('click', () => onTerritoryClick(t));

    gameMapSvg.appendChild(g);
  });
}

function onTerritoryClick(territory) {
  const gameState = currentRoom.gameState;
  const currentPlayer = currentRoom.players[gameState.currentTurnIndex];
  const activePlayerId = isLocalGame ? currentPlayer.id : myPlayerId;

  if (!isLocalGame && !isMyTurn) return;

  const territories = gameState.territories;

  // Case 1: Select owned territory with > 1 dice
  if (territory.owner === activePlayerId && territory.dice > 1) {
    sfx.select();
    selectedTerritoryId = (selectedTerritoryId === territory.id) ? null : territory.id;
    renderMap();
    return;
  }

  // Case 2: Attack adjacent target
  if (selectedTerritoryId) {
    const selected = territories.find(t => t.id === selectedTerritoryId);
    if (selected && selected.neighbors.includes(territory.id) && territory.owner !== activePlayerId) {
      sfx.attackClash();

      if (isLocalGame) {
        executeLocalAttack(selected.id, territory.id);
      } else {
        socket.emit('attack', { fromId: selected.id, toId: territory.id });
      }
      selectedTerritoryId = null;
      renderMap();
      return;
    }
  }

  // Deselect
  if (selectedTerritoryId) {
    selectedTerritoryId = null;
    renderMap();
  }
}

// Local Attack Execution
function executeLocalAttack(fromId, toId) {
  const gameState = currentRoom.gameState;
  const territories = gameState.territories;
  const source = territories.find(t => t.id === fromId);
  const target = territories.find(t => t.id === toId);

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
  const prevOwner = target.owner;

  if (attackerWon) {
    target.owner = source.owner;
    target.dice = source.dice - 1;
    source.dice = 1;
  } else {
    source.dice = 1;
  }

  const battleResult = {
    attackerId: source.owner,
    prevTargetOwner: prevOwner,
    toId: target.id,
    attackerRolls,
    defenderRolls,
    attackerSum,
    defenderSum,
    attackerWon
  };

  showBattleClash(battleResult);
  checkLocalGameOver();
  updateGameUI(currentRoom);
}

function checkLocalGameOver() {
  const territories = currentRoom.gameState.territories;
  const aliveIds = new Set(territories.filter(t => t.owner !== null).map(t => t.owner));

  if (aliveIds.size === 1) {
    const winnerId = [...aliveIds][0];
    const winner = currentRoom.players.find(p => p.id === winnerId);
    sfx.victoryFanfare();
    gameOverModal.classList.remove('hidden');

    document.getElementById('winnerTitle').textContent = `🏆 ПОБЕДИЛ ${winner.name}!`;
    document.getElementById('winnerTitle').style.color = winner.color.hex;
    document.getElementById('winnerSubtitle').textContent = `Все сектора карты захвачены!`;
    document.getElementById('victoryStats').innerHTML = `
      <div>⏳ Раундов сыграно: ${currentRoom.gameState.round}</div>
      <div>🗺️ Захвачено секторов: ${territories.length}</div>
    `;
  }
}

// ------------------------------------------
// GAME STATUS & SIDEBAR UPDATES
// ------------------------------------------
function updateGameUI(room) {
  currentRoom = room;
  const gameState = room.gameState;
  if (!gameState) return;

  roundNumber.textContent = gameState.round;

  const currentPlayer = room.players[gameState.currentTurnIndex];
  isMyTurn = !isLocalGame && (currentPlayer && currentPlayer.id === myPlayerId);

  // Update Turn Status Bar
  if (currentPlayer) {
    if (isLocalGame) {
      turnPlayerName.textContent = `Ход: ${currentPlayer.name} (${currentPlayer.color.name})`;
      hotseatPrompt.innerHTML = `👉 Передайте устройство игроку <strong>${currentPlayer.name}</strong>!`;
    } else {
      turnPlayerName.textContent = isMyTurn ? 'ВАШ ХОД! ⚔️' : currentPlayer.name;
    }
    turnPlayerName.style.color = currentPlayer.color.hex;
    turnIndicatorDot.style.backgroundColor = currentPlayer.color.hex;
    turnIndicatorDot.style.boxShadow = `0 0 15px ${currentPlayer.color.hex}`;
  }

  btnEndTurn.disabled = (!isMyTurn && !isLocalGame);

  // Update Sidebar Players
  const totalTerritories = gameState.territories.length;
  gamePlayersList.innerHTML = '';

  room.players.forEach(p => {
    const playerTerritories = gameState.territories.filter(t => t.owner === p.id);
    const count = playerTerritories.length;
    const totalArmies = playerTerritories.reduce((acc, t) => acc + t.dice, 0);
    const pct = totalTerritories > 0 ? Math.round((count / totalTerritories) * 100) : 0;
    const isEliminated = count === 0;
    const isTurn = currentPlayer && currentPlayer.id === p.id;

    const card = document.createElement('div');
    card.className = `game-player-card ${isTurn ? 'active-turn' : ''} ${isEliminated ? 'eliminated' : ''}`;

    card.innerHTML = `
      <div class="player-card-header">
        <span class="player-card-name" style="color: ${p.color.hex}">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${p.color.hex}"></span>
          ${p.name} ${(!isLocalGame && p.id === myPlayerId) ? '(Вы)' : ''} ${isEliminated ? '💀' : ''}
        </span>
        <span class="player-stats-numbers">
          <strong>${count}</strong> зон • <strong>${totalArmies}</strong> 🎲
        </span>
      </div>
      <div class="territory-progress-bar">
        <div class="territory-progress-fill" style="width: ${pct}%; background: ${p.color.hex}"></div>
      </div>
    `;

    gamePlayersList.appendChild(card);
  });

  renderMap();
}

// End Turn Button
btnEndTurn.addEventListener('click', () => {
  sfx.click();
  selectedTerritoryId = null;

  if (isLocalGame) {
    advanceLocalTurn();
  } else {
    socket.emit('endTurn');
  }
});

function advanceLocalTurn() {
  const gameState = currentRoom.gameState;
  const territories = gameState.territories;
  const players = currentRoom.players;

  // Give reinforcements to current player
  const currPlayer = players[gameState.currentTurnIndex];
  const playerTerritories = territories.filter(t => t.owner === currPlayer.id);
  const bonus = Math.max(2, Math.floor(playerTerritories.length / 2));
  
  let left = bonus;
  const eligible = playerTerritories.filter(t => t.dice < 8);
  while (left > 0 && eligible.some(t => t.dice < 8)) {
    const valid = eligible.filter(t => t.dice < 8);
    if (valid.length === 0) break;
    const chosen = valid[Math.floor(Math.random() * valid.length)];
    chosen.dice++;
    left--;
  }

  // Next player
  let nextIdx = (gameState.currentTurnIndex + 1) % players.length;
  let attempts = 0;
  while (!territories.some(t => t.owner === players[nextIdx].id) && attempts < players.length) {
    nextIdx = (nextIdx + 1) % players.length;
    attempts++;
  }

  if (nextIdx <= gameState.currentTurnIndex) {
    gameState.round++;
  }
  gameState.currentTurnIndex = nextIdx;

  sfx.turnChime();
  updateGameUI(currentRoom);
}

// Battle Clash Popup Animation
function showBattleClash(battle) {
  const attacker = currentRoom.players.find(p => p.id === battle.attackerId);
  const defender = battle.prevTargetOwner ? currentRoom.players.find(p => p.id === battle.prevTargetOwner) : null;

  const batAtkName = document.getElementById('batAtkName');
  const batDefName = document.getElementById('batDefName');
  const batAtkDice = document.getElementById('batAtkDice');
  const batDefDice = document.getElementById('batDefDice');
  const batAtkSum = document.getElementById('batAtkSum');
  const batDefSum = document.getElementById('batDefSum');
  const batVerdict = document.getElementById('batVerdict');

  batAtkName.textContent = attacker ? attacker.name : 'Атакующий';
  batAtkName.style.color = attacker ? attacker.color.hex : '#EF4444';

  batDefName.textContent = defender ? defender.name : 'Нейтрал';
  batDefName.style.color = defender ? defender.color.hex : '#94A3B8';

  batAtkDice.innerHTML = '';
  battle.attackerRolls.forEach(val => {
    const cube = document.createElement('div');
    cube.className = 'dice-cube';
    cube.textContent = val;
    batAtkDice.appendChild(cube);
  });

  batDefDice.innerHTML = '';
  battle.defenderRolls.forEach(val => {
    const cube = document.createElement('div');
    cube.className = 'dice-cube';
    cube.textContent = val;
    batDefDice.appendChild(cube);
  });

  batAtkSum.textContent = battle.attackerSum;
  batDefSum.textContent = battle.defenderSum;

  if (battle.attackerWon) {
    batVerdict.textContent = `Победа атакующего! (${battle.attackerSum} против ${battle.defenderSum})`;
    batVerdict.style.color = '#10B981';
    if (!isLocalGame && battle.attackerId === myPlayerId) sfx.winBattle();
  } else {
    batVerdict.textContent = `Защитник отбил атаку! (${battle.defenderSum} против ${battle.attackerSum})`;
    batVerdict.style.color = '#EF4444';
    if (!isLocalGame && battle.attackerId === myPlayerId) sfx.loseBattle();
  }

  battleModal.classList.remove('hidden');

  addBattleLogEntry(
    battle.attackerWon 
      ? `⚔️ <strong>${batAtkName.textContent}</strong> захватил сектор #${battle.toId} у ${batDefName.textContent} (${battle.attackerSum} : ${battle.defenderSum})`
      : `🛡️ <strong>${batDefName.textContent}</strong> удержал сектор #${battle.toId} против ${batAtkName.textContent} (${battle.defenderSum} : ${battle.attackerSum})`,
    battle.attackerWon ? 'win' : 'loss'
  );

  setTimeout(() => {
    battleModal.classList.add('hidden');
  }, 1600);
}

function addBattleLogEntry(htmlText, type = 'system') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = htmlText;
  battleLog.prepend(entry);
}

// Sidebar Tabs
document.querySelectorAll('.sidebar-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const targetId = 'tab' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1);
    const targetPane = document.getElementById(targetId);
    if (targetPane) targetPane.classList.add('active');
  });
});

// Reactions
document.querySelectorAll('.react-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const emoji = btn.dataset.emoji;
    if (!isLocalGame) {
      socket.emit('sendReaction', { emoji });
    } else {
      spawnFloatingEmoji(emoji);
    }
  });
});

function spawnFloatingEmoji(emoji) {
  const el = document.createElement('div');
  el.className = 'floating-emoji';
  el.textContent = emoji;
  el.style.left = `${15 + Math.random() * 70}%`;
  el.style.top = `${60 + Math.random() * 20}%`;
  emojiContainer.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

// Chat
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (text) {
    if (!isLocalGame) {
      socket.emit('sendChatMessage', { text });
    } else {
      addChatMessage('Игрок', text, '#3B82F6');
    }
    chatInput.value = '';
  }
});

function addChatMessage(sender, text, color = '#FFFFFF', isSystem = false) {
  const msg = document.createElement('div');
  msg.className = `chat-msg ${isSystem ? 'system' : ''}`;
  if (isSystem) {
    msg.textContent = `[${sender}]: ${text}`;
  } else {
    msg.innerHTML = `<strong style="color:${color}">${sender}:</strong> ${escapeHtml(text)}`;
  }
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Game Over & Restart
document.getElementById('btnPlayAgain').addEventListener('click', () => {
  gameOverModal.classList.add('hidden');
  if (isLocalGame) {
    btnStartLocalGame.click();
  } else {
    socket.emit('restartGame');
  }
});

document.getElementById('btnBackToMenu').addEventListener('click', () => {
  window.location.href = window.location.origin;
});

// ------------------------------------------
// SOCKET.IO LISTENERS (ONLINE)
// ------------------------------------------
socket.on('roomCreated', ({ room, playerId }) => {
  myPlayerId = playerId;
  currentRoom = room;
  window.history.pushState({}, '', `?room=${room.id}`);
  showScreen(screenLobby);
  updateLobbyUI(room);
  showToast(`Комната ${room.id} создана! Ссылка и QR-код готовы.`);
});

socket.on('roomJoined', ({ room, playerId }) => {
  myPlayerId = playerId;
  currentRoom = room;
  window.history.pushState({}, '', `?room=${room.id}`);
  showScreen(screenLobby);
  updateLobbyUI(room);
  showToast(`Вы вошли в комнату ${room.id}!`);
});

socket.on('roomUpdated', (room) => {
  currentRoom = room;
  if (room.status === 'lobby') {
    showScreen(screenLobby);
    updateLobbyUI(room);
  } else if (room.status === 'playing') {
    updateGameUI(room);
  }
});

socket.on('gameStarted', ({ room, currentTurnPlayerId, currentTurnPlayerName }) => {
  currentRoom = room;
  hotseatPrompt.classList.add('hidden');
  showScreen(screenGame);
  updateGameUI(room);
  showToast('⚔️ Игра началась! Захватывайте сектора!');
  sfx.turnChime();
});

socket.on('gameRestarted', () => {
  showScreen(screenLobby);
  gameOverModal.classList.add('hidden');
  updateLobbyUI(currentRoom);
  showToast('Игра перезапущена. Создатель может начать новый раунд.');
});

socket.on('timerTick', ({ secondsLeft }) => {
  timerSeconds.textContent = secondsLeft;
  timerSeconds.style.color = (secondsLeft <= 5) ? '#EF4444' : '#06B6D4';
});

socket.on('turnChanged', ({ currentTurnIndex, currentTurnPlayerId, currentTurnPlayerName, round, previousPlayerReinforcements, territories, timedOut }) => {
  if (currentRoom && currentRoom.gameState) {
    currentRoom.gameState.round = round;
    currentRoom.gameState.territories = territories;
    if (typeof currentTurnIndex === 'number') {
      currentRoom.gameState.currentTurnIndex = currentTurnIndex;
    } else {
      const idx = currentRoom.players.findIndex(p => p.id === currentTurnPlayerId);
      if (idx !== -1) currentRoom.gameState.currentTurnIndex = idx;
    }
  }

  isMyTurn = (currentTurnPlayerId === myPlayerId);
  selectedTerritoryId = null;

  if (isMyTurn) {
    sfx.turnChime();
    showToast('ВАШ ХОД! Выберите свою территорию с 2+ армиями.');
  }

  if (previousPlayerReinforcements > 0) {
    addBattleLogEntry(`🛡️ Завершение хода: игрок получил +${previousPlayerReinforcements} армий.`);
  }

  updateGameUI(currentRoom);
});

socket.on('battleResolved', (battleResult) => {
  if (currentRoom && currentRoom.gameState) {
    currentRoom.gameState.territories = battleResult.territories;
  }
  showBattleClash(battleResult);
  renderMap();
});

socket.on('territoriesUpdated', (territories) => {
  if (currentRoom && currentRoom.gameState) {
    currentRoom.gameState.territories = territories;
    renderMap();
  }
});

socket.on('gameOver', ({ winner, stats }) => {
  gameOverModal.classList.remove('hidden');
  sfx.victoryFanfare();

  const winnerTitle = document.getElementById('winnerTitle');
  const winnerSubtitle = document.getElementById('winnerSubtitle');
  const victoryStats = document.getElementById('victoryStats');

  if (winner) {
    winnerTitle.textContent = (!isLocalGame && winner.id === myPlayerId) ? '🏆 ВЫ ПОБЕДИЛИ!' : `🏆 ПОБЕДИЛ ${winner.name}!`;
    winnerTitle.style.color = winner.color ? winner.color.hex : '#FCD34D';
    winnerSubtitle.textContent = `Империя полностью подчинена!`;
  }

  victoryStats.innerHTML = `
    <div>⏳ <strong>Раундов сыграно:</strong> ${stats.totalRounds}</div>
    <div>🗺️ <strong>Всего секторов на карте:</strong> ${stats.territories}</div>
  `;
});

socket.on('reactionReceived', ({ playerName, emoji }) => {
  spawnFloatingEmoji(emoji);
});

socket.on('chatMessage', ({ sender, color, text, isSystem }) => {
  addChatMessage(sender, text, color, isSystem);
});

socket.on('errorMsg', (msg) => {
  showToast(msg);
});
