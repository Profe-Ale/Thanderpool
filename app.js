// ==========================================
// ESTADO GLOBAL DE LA APLICACIÓN
// ==========================================
const state = {
  ws: null,
  connectedChannel: null,
  demoInterval: null,
  participants: [],
  wheelAngle: 0,
  isSpinning: false,
  pollActive: false,
  pollOptions: [],
  pollVotes: {}, // { username: optionIndex }
  wordCount: 0
};

const WHEEL_COLORS = [
  '#9146ff', '#00b87c', '#ff4d6d', '#3a86ff',
  '#ff9f1c', '#8338ec', '#06d6a0', '#ef476f'
];

// ==========================================
// ELEMENTOS DEL DOM
// ==========================================
const channelInput = document.getElementById('channelInput');
const connectBtn = document.getElementById('connectBtn');
const demoBtn = document.getElementById('demoBtn');
const obsModeBtn = document.getElementById('obsModeBtn');
const statusBadge = document.getElementById('statusBadge');

const wheelCanvas = document.getElementById('wheelCanvas');
const ctx = wheelCanvas.getContext('2d');
const spinBtn = document.getElementById('spinBtn');
const winnerBanner = document.getElementById('winnerBanner');
const winnerName = document.getElementById('winnerName');
const removeWinnerBtn = document.getElementById('removeWinnerBtn');

const keywordInput = document.getElementById('keywordInput');
const matchMode = document.getElementById('matchMode');
const spinDuration = document.getElementById('spinDuration');
const allowDuplicates = document.getElementById('allowDuplicates');
const soundEnabled = document.getElementById('soundEnabled');
const participantCount = document.getElementById('participantCount');
const participantsList = document.getElementById('participantsList');
const chatMessages = document.getElementById('chatMessages');

// ==========================================
// SOPORTE PARÁMETROS URL (PARA OBS AUTOMÁTICO)
// Ej: tuweb.github.io/repo/?canal=tucanal&obs=1
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const canalParam = params.get('canal');
  const kwParam = params.get('palabra');
  const obsParam = params.get('obs');

  if (kwParam) keywordInput.value = kwParam;
  if (canalParam) {
    channelInput.value = canalParam;
    connectToTwitch(canalParam);
  }
  if (obsParam === '1') {
    toggleObsMode(true);
  }

  drawWheel();
});

// ==========================================
// CONEXIÓN REAL A TWITCH IRC (WEBSOCKETS)
// ==========================================
function connectToTwitch(rawChannel) {
  const channel = rawChannel.trim().toLowerCase().replace('#', '');
  if (!channel) return;

  stopDemo();
  if (state.ws) {
    state.ws.close();
  }

  addSystemMessage(`Conectando al chat de #${channel}...`);
  const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
  state.ws = ws;

  ws.onopen = () => {
    ws.send('CAP REQ :twitch.tv/tags');
    ws.send('PASS SCHMOOPIIE');
    ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 89999)}`);
    ws.send(`JOIN #${channel}`);

    state.connectedChannel = channel;
    statusBadge.textContent = `EN VIVO: #${channel.toUpperCase()}`;
    statusBadge.className = 'badge-live connected';
    addSystemMessage(`Conectado exitosamente a #${channel}.`);
  };

  ws.onmessage = (event) => {
    const lines = event.data.split('\r\n');
    for (const line of lines) {
      if (!line) continue;
      if (line.startsWith('PING')) {
        ws.send('PONG :tmi.twitch.tv');
        continue;
      }

      if (line.includes('PRIVMSG')) {
        const parsed = parseTwitchMessage(line);
        if (parsed) {
          handleIncomingChatMessage(parsed.username, parsed.message, parsed.color);
        }
      }
    }
  };

  ws.onerror = () => {
    addSystemMessage('Error de conexión con Twitch IRC.');
  };

  ws.onclose = () => {
    if (state.connectedChannel === channel) {
      statusBadge.textContent = 'DESCONECTADO';
      statusBadge.className = 'badge-live';
    }
  };
}

function parseTwitchMessage(raw) {
  try {
    let color = '#9146ff';
    let displayName = null;

    if (raw.startsWith('@')) {
      const tagsPart = raw.split(' ')[0];
      const tags = tagsPart.substring(1).split(';');
      for (const tag of tags) {
        const [k, v] = tag.split('=');
        if (k === 'color' && v) color = v;
        if (k === 'display-name' && v) displayName = v;
      }
    }

    const userMatch = raw.match(/:([^!]+)!/);
    const msgMatch = raw.match(/PRIVMSG #[^ ]+ :(.*)$/);
    if (!msgMatch) return null;

    const username = displayName || (userMatch ? userMatch[1] : 'Viewer');
    const message = msgMatch[1].trim();
    return { username, message, color };
  } catch {
    return null;
  }
}

// ==========================================
// PROCESAMIENTO CENTRAL DE MENSAJES DEL CHAT
// ==========================================
function handleIncomingChatMessage(username, message, color = '#00f5d4') {
  renderChatMessage(username, message, color);

  // 1. Verificar entrada a la Ruleta
  const kw = keywordInput.value.trim().toLowerCase();
  const msgLower = message.toLowerCase();
  const mode = matchMode.value;

  let matched = false;
  if (mode === 'any') matched = true;
  else if (kw) {
    if (mode === 'starts' && msgLower.startsWith(kw)) matched = true;
    if (mode === 'exact' && msgLower === kw) matched = true;
    if (mode === 'contains' && msgLower.includes(kw)) matched = true;
  }

  if (matched) {
    addParticipant(username);
  }

  // 2. Verificar voto en Encuesta
  if (state.pollActive) {
    const choice = parseInt(message.trim(), 10);
    if (!isNaN(choice) && choice >= 1 && choice <= state.pollOptions.length) {
      state.pollVotes[username.toLowerCase()] = choice - 1;
      renderPollResults();
    }
  }

  // 3. Contador de palabra/emote
  const trackedWord = document.getElementById('trackWordInput').value.trim().toLowerCase();
  if (trackedWord && msgLower.includes(trackedWord)) {
    state.wordCount++;
    document.getElementById('wordCounterValue').textContent = state.wordCount;
  }
}

function renderChatMessage(username, message, color) {
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<span class="chat-author" style="color:${color}">${escapeHtml(username)}:</span><span>${escapeHtml(message)}</span>`;
  
  // Al hacer clic en un mensaje, se fija en la pestaña Destacados
  div.addEventListener('click', () => {
    document.getElementById('pinnedUser').textContent = username;
    document.getElementById('pinnedText').textContent = message;
  });

  chatMessages.appendChild(div);
  if (chatMessages.children.length > 80) {
    chatMessages.removeChild(chatMessages.firstChild);
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'system-msg';
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ==========================================
// LÓGICA DE LA RULETA
// ==========================================
function addParticipant(name) {
  const cleanName = name.trim();
  if (!cleanName) return;

  if (!allowDuplicates.checked) {
    const exists = state.participants.some(p => p.toLowerCase() === cleanName.toLowerCase());
    if (exists) return;
  }

  state.participants.push(cleanName);
  updateParticipantsUI();
  drawWheel();
}

function removeParticipant(index) {
  state.participants.splice(index, 1);
  updateParticipantsUI();
  drawWheel();
}

function updateParticipantsUI() {
  participantCount.textContent = state.participants.length;
  participantsList.innerHTML = '';

  state.participants.forEach((name, idx) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(name)}</span><button title="Eliminar">✕</button>`;
    li.querySelector('button').addEventListener('click', () => removeParticipant(idx));
    participantsList.appendChild(li);
  });
}

function drawWheel() {
  const cx = wheelCanvas.width / 2;
  const cy = wheelCanvas.height / 2;
  const radius = cx - 12;

  ctx.clearRect(0, 0, wheelCanvas.width, wheelCanvas.height);

  const items = state.participants.length > 0 ? state.participants : ['Esperando chat...'];
  const sliceAngle = (2 * Math.PI) / items.length;

  items.forEach((label, i) => {
    const startAngle = state.wheelAngle + i * sliceAngle;
    const endAngle = startAngle + sliceAngle;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.closePath();

    ctx.fillStyle = state.participants.length > 0
      ? WHEEL_COLORS[i % WHEEL_COLORS.length]
      : '#26262c';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#18181b';
    ctx.stroke();

    // Texto del participante
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(startAngle + sliceAngle / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = items.length > 25 ? 'bold 12px sans-serif' : 'bold 16px sans-serif';
    const shortLabel = label.length > 16 ? label.substring(0, 15) + '…' : label;
    ctx.fillText(shortLabel, radius - 22, 5);
    ctx.restore();
  });

  // Aro exterior
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#9146ff';
  ctx.stroke();
}

function spinWheel() {
  if (state.isSpinning || state.participants.length < 2) {
    if (state.participants.length < 2) {
      addSystemMessage('Se necesitan al menos 2 participantes para girar la ruleta.');
    }
    return;
  }

  state.isSpinning = true;
  winnerBanner.classList.add('hidden');

  const durationMs = Math.max(2, parseInt(spinDuration.value, 10) || 6) * 1000;
  const startAngle = state.wheelAngle;
  const extraSpins = (5 + Math.random() * 5) * 2 * Math.PI;
  const targetAngle = startAngle + extraSpins;
  const startTime = performance.now();
  let lastTickSlice = -1;

  function animate(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / durationMs, 1);
    // Curva de desaceleración suave (easeOutCubic)
    const ease = 1 - Math.pow(1 - progress, 3);

    state.wheelAngle = startAngle + (targetAngle - startAngle) * ease;
    drawWheel();

    // Sonido tick al pasar cada sector
    const sliceAngle = (2 * Math.PI) / state.participants.length;
    const currentSlice = Math.floor(((state.wheelAngle % (2 * Math.PI)) + 2 * Math.PI) / sliceAngle);
    if (currentSlice !== lastTickSlice) {
      lastTickSlice = currentSlice;
      playTickSound();
    }

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      state.isSpinning = false;
      announceWinner();
    }
  }

  requestAnimationFrame(animate);
}

function announceWinner() {
  const n = state.participants.length;
  const sliceAngle = (2 * Math.PI) / n;
  // El puntero está arriba (-PI/2)
  const pointerAngle = (3 * Math.PI) / 2;
  const normalized = (pointerAngle - (state.wheelAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const winnerIndex = Math.floor(normalized / sliceAngle) % n;
  const winner = state.participants[winnerIndex];

  winnerName.textContent = winner;
  winnerBanner.classList.remove('hidden');
  playWinSound();
  launchConfetti();

  removeWinnerBtn.onclick = () => {
    removeParticipant(winnerIndex);
    winnerBanner.classList.add('hidden');
  };
}

// ==========================================
// SONIDOS SINTETIZADOS (SIN ARCHIVOS EXTERNOS)
// ==========================================
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playTickSound() {
  if (!soundEnabled.checked) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(520, audioCtx.currentTime);
  gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.04);
}

function playWinSound() {
  if (!soundEnabled.checked) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, idx) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime + idx * 0.1);
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime + idx * 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + idx * 0.1 + 0.35);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(audioCtx.currentTime + idx * 0.1);
    osc.stop(audioCtx.currentTime + idx * 0.1 + 0.35);
  });
}

// ==========================================
// ENCUESTAS Y MODO DEMO
// ==========================================
document.getElementById('startPollBtn').addEventListener('click', () => {
  const inputs = [...document.querySelectorAll('.poll-opt-input')];
  state.pollOptions = inputs.map(i => i.value.trim()).filter(Boolean);
  if (state.pollOptions.length < 2) return;
  state.pollVotes = {};
  state.pollActive = true;
  renderPollResults();
  addSystemMessage('¡Encuesta iniciada! Escribe 1, 2, 3... en el chat.');
});

document.getElementById('stopPollBtn').addEventListener('click', () => {
  state.pollActive = false;
  addSystemMessage('Encuesta cerrada.');
});

function renderPollResults() {
  const container = document.getElementById('pollResults');
  const totalVotes = Object.keys(state.pollVotes).length;
  const counts = new Array(state.pollOptions.length).fill(0);
  Object.values(state.pollVotes).forEach(idx => counts[idx]++);

  container.innerHTML = state.pollOptions.map((opt, idx) => {
    const pct = totalVotes > 0 ? Math.round((counts[idx] / totalVotes) * 100) : 0;
    return `
      <div class="poll-bar-item">
        <div class="poll-bar-label">
          <span><strong>${idx + 1}.</strong> ${escapeHtml(opt)}</span>
          <span>${counts[idx]} votos (${pct}%)</span>
        </div>
        <div class="poll-bar-track">
          <div class="poll-bar-fill" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

function startDemo() {
  if (state.ws) state.ws.close();
  stopDemo();
  statusBadge.textContent = 'MODO DEMO';
  statusBadge.className = 'badge-live demo';
  addSystemMessage('Modo Demo activo: simulando espectadores...');

  const fakeUsers = ['SantiGamer', 'LunaStream', 'ProfeAle', 'MatiArg', 'KiraVT', 'TomiGG', 'NatiPlay', 'FedeTech'];
  state.demoInterval = setInterval(() => {
    const user = fakeUsers[Math.floor(Math.random() * fakeUsers.length)] + Math.floor(Math.random() * 99);
    const kw = keywordInput.value.trim() || '!participar';
    const sampleMsgs = [kw, `${kw} vamos!`, 'GG', '1', '2', 'Hola chat!'];
    const msg = sampleMsgs[Math.floor(Math.random() * sampleMsgs.length)];
    handleIncomingChatMessage(user, msg);
  }, 1600);
}

function stopDemo() {
  if (state.demoInterval) {
    clearInterval(state.demoInterval);
    state.demoInterval = null;
  }
}

// ==========================================
// MODO OBS Y EVENTOS DE INTERFAZ
// ==========================================
function toggleObsMode(forceState) {
  const enable = typeof forceState === 'boolean' ? forceState : !document.body.classList.contains('obs-mode');
  document.body.classList.toggle('obs-mode', enable);

  let exitBtn = document.getElementById('exitObsBtn');
  if (enable && !exitBtn) {
    exitBtn = document.createElement('button');
    exitBtn.id = 'exitObsBtn';
    exitBtn.className = 'btn btn-secondary exit-obs-btn';
    exitBtn.textContent = 'Salir Vista OBS';
    exitBtn.onclick = () => toggleObsMode(false);
    document.body.appendChild(exitBtn);
  } else if (!enable && exitBtn) {
    exitBtn.remove();
  }
}

connectBtn.addEventListener('click', () => connectToTwitch(channelInput.value));
demoBtn.addEventListener('click', startDemo);
obsModeBtn.addEventListener('click', () => toggleObsMode());
spinBtn.addEventListener('click', spinWheel);

document.getElementById('manualAddBtn').addEventListener('click', () => {
  const inp = document.getElementById('manualNameInput');
  addParticipant(inp.value);
  inp.value = '';
});

document.getElementById('addDemoUsersBtn').addEventListener('click', () => {
  ['Lucas99', 'SofiPlay', 'ValenGG', 'NicoArg', 'CamilaTV'].forEach(addParticipant);
});

document.getElementById('clearWheelBtn').addEventListener('click', () => {
  state.participants = [];
  winnerBanner.classList.add('hidden');
  updateParticipantsUI();
  drawWheel();
});

document.getElementById('clearChatBtn').addEventListener('click', () => {
  chatMessages.innerHTML = '';
});

document.getElementById('simSendBtn').addEventListener('click', () => {
  const u = document.getElementById('simUser').value || 'Viewer';
  const m = document.getElementById('simMsg').value;
  if (!m) return;
  handleIncomingChatMessage(u, m);
  document.getElementById('simMsg').value = '';
});

document.getElementById('clearPinBtn').addEventListener('click', () => {
  document.getElementById('pinnedUser').textContent = 'Ningún mensaje fijado';
  document.getElementById('pinnedText').textContent = 'Selecciona un mensaje del chat en vivo para destacarlo.';
});

document.getElementById('resetCounterBtn').addEventListener('click', () => {
  state.wordCount = 0;
  document.getElementById('wordCounterValue').textContent = '0';
});

// Cambio de pestañas
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// Confeti
function launchConfetti() {
  const canvas = document.getElementById('confettiCanvas');
  const c = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const pieces = Array.from({ length: 90 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * 100,
    size: 6 + Math.random() * 6,
    color: WHEEL_COLORS[Math.floor(Math.random() * WHEEL_COLORS.length)],
    vy: 3 + Math.random() * 4,
    vx: (Math.random() - 0.5) * 4
  }));

  let frames = 0;
  function step() {
    c.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      c.fillStyle = p.color;
      c.fillRect(p.x, p.y, p.size, p.size);
    });
    frames++;
    if (frames < 140) requestAnimationFrame(step);
    else c.clearRect(0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(step);
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}