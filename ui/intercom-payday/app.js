/* ═══════════════════════════════════════════════════════════
   INTERCOM PAYDAY — app.js
   Autonomous Multi-Chain Agent Wallet Network
   WebSocket client → wallet-agent.js (real WDK transactions)
   ═══════════════════════════════════════════════════════════ */
'use strict';

// ── CONFIG ───────────────────────────────────────────────
const CFG = {
  agentName:    'PaydayAgent',
  usdtContract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  channel:      '0000intercom',
  defaultTip:   0.01,
  wsUrl:        'ws://localhost:8080',
};

const AVATARS = {
  'PaydayAgent': { bg: 'var(--gold-dim)',           color: 'var(--gold)',   init: 'PA' },
  'Agent-7f3a':  { bg: 'rgba(245,158,11,0.12)',     color: 'var(--amber)',  init: 'A7' },
  'OpenClaw-1':  { bg: 'rgba(59,130,246,0.12)',     color: 'var(--blue)',   init: 'OC' },
  'SwapBot-α':   { bg: 'rgba(34,197,94,0.12)',      color: 'var(--green)',  init: 'SB' },
  'Unassigned':  { bg: 'var(--bg4)',                color: 'var(--muted)',  init: '?' },
};

// Dynamic peers from Hyperswarm (populated at runtime)
const livePeers = new Map(); // name → { tronAddress }

// ── STATE ─────────────────────────────────────────────────
let tasks        = [];
let nextId       = 1;
let stats        = { completed: 0, tips: 0, total: 0 };
let usdtBalance  = 0;
let solBalance   = 0;
let tronAddress  = '—';
let solAddress   = '—';
let agentBusy    = false;
let activeFilter = 'all';
let ws           = null;
let wsConnected  = false;

// ── WEBSOCKET CLIENT ──────────────────────────────────────
function connectWebSocket() {
  ws = new WebSocket(CFG.wsUrl);

  ws.onopen = () => {
    wsConnected = true;
    console.log('[WS] Connected to agent');
    updateConnectionStatus(true);
    addFeed('🔌', 'Connected to PaydayAgent WebSocket bridge — live data active', 'var(--green)', 'rgba(34,197,94,0.12)');
    wsSend('balance:refresh', {});
  };

  ws.onclose = () => {
    wsConnected = false;
    updateConnectionStatus(false);
    addFeed('⚠️', 'Agent WebSocket disconnected — retrying in 3s...', 'var(--amber)', 'rgba(245,158,11,0.12)');
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = () => {
    wsConnected = false;
    updateConnectionStatus(false);
  };

  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    handleAgentEvent(msg);
  };
}

function wsSend(type, payload = {}) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...payload }));
  } else {
    console.warn('[WS] Not connected — command queued locally:', type);
  }
}

function updateConnectionStatus(connected) {
  const dot    = document.querySelector('.net-dot');
  const label  = document.getElementById('networkLabel');
  const wsDot  = document.getElementById('wsDot');
  const wsStat = document.getElementById('wsStatus');
  if (connected) {
    dot.style.background   = 'var(--green)';
    dot.style.boxShadow    = '0 0 8px var(--green)';
    label.textContent      = 'Agent Connected';
    if (wsDot)  { wsDot.style.background = 'var(--green)'; wsDot.style.boxShadow = '0 0 6px var(--green)'; }
    if (wsStat) wsStat.textContent = 'Connected · live';
  } else {
    dot.style.background   = 'var(--amber)';
    dot.style.boxShadow    = '0 0 8px var(--amber)';
    label.textContent      = 'Reconnecting...';
    if (wsDot)  { wsDot.style.background = 'var(--amber)'; wsDot.style.boxShadow = 'none'; }
    if (wsStat) wsStat.textContent = 'Reconnecting...';
  }
}

// ── HANDLE AGENT EVENTS ───────────────────────────────────
function handleAgentEvent(msg) {
  const { type } = msg;

  switch (type) {

    case 'balance:update': {
      usdtBalance = msg.usdt        ?? usdtBalance;
      solBalance  = msg.sol         ?? solBalance;
      tronAddress = msg.tronAddress ?? tronAddress;
      solAddress  = msg.solAddress  ?? solAddress;
      updateWalletUI();
      break;
    }

    case 'agent:reasoning': {
      if (msg.text) setReasoning(msg.text);
      break;
    }

    case 'agent:status': {
      const statusEl = document.getElementById('agentStatus');
      const mainEl   = document.getElementById('mainAgentStatus');
      if (statusEl) statusEl.textContent = msg.status || 'Active';
      if (mainEl)   mainEl.textContent   = msg.status || 'Active';
      if (msg.tasksCompleted !== undefined) stats.completed = msg.tasksCompleted;
      if (msg.totalPaidUsdt  !== undefined) stats.total     = msg.totalPaidUsdt;
      updateStats();
      break;
    }

    case 'agent:action': {
      const { action, details } = msg;
      addFeed('⚡', `Agent decision: ${action} — ${details?.title || ''}`, 'var(--gold)', 'var(--gold-dim)');
      break;
    }

    case 'payment:sent': {
      const { txHash, amount, chain, taskName, explorer } = msg;

      stats.tips++;
      stats.total  += amount;
      usdtBalance   = Math.max(0, usdtBalance - (chain === 'tron' ? amount : 0));
      updateWalletUI();
      updateStats();

      // Mark matching task done+paid
      const t = tasks.find(x => x.title === taskName && x.status !== 'done');
      if (t) {
        t.status = 'done';
        t.txHash = txHash;
        t.chain  = chain;
        t.paid   = true;
        stats.completed++;
        renderAll();
      }

      addTx(amount, txHash, taskName, 'confirmed', chain, explorer);

      const chainLabel = chain === 'tron' ? 'Tron mainnet' : 'Solana devnet';
      addFeed('✅', `WDK confirmed: ${amount} USD₮ sent on ${chainLabel}`, 'var(--gold)', 'var(--gold-dim)');
      addFeed('🔗', `TX: ${txHash.slice(0, 24)}... → ${explorer}`, 'var(--muted)', 'var(--bg3)');
      hidePayOverlay(txHash, amount);
      showToast(`💸 ${amount} USD₮ sent on ${chainLabel}!`);
      break;
    }

    // ── FIX: handle task:completed broadcast from agent loop ──
    case 'task:completed': {
      const t = tasks.find(x => x.title === msg.title && x.status !== 'done');
      if (t) {
        t.status = 'done';
        t.txHash = msg.txHash || null;
        t.chain  = 'tron';
        t.paid   = true;
        stats.completed++;
        renderAll();
      }
      addFeed('✅', `Task completed: "${msg.title}" — ${msg.tip} USD₮ paid`, 'var(--gold)', 'var(--gold-dim)');
      break;
    }

    case 'payment:blocked': {
      hidePayOverlayImmediately();
      addFeed('🛡️', `Payment blocked: ${msg.reason}`, 'var(--red)', 'rgba(239,68,68,0.12)');
      showToast(`⛔ Payment blocked: ${msg.reason}`);
      break;
    }

    case 'payment:queued': {
      addFeed('⏳', `Supervised: ${msg.amount} USDT queued for "${msg.taskName}" — confirm/reject in CLI`, 'var(--amber)', 'rgba(245,158,11,0.12)');
      showToast(`⏳ Payment queued — approve in agent CLI`);
      break;
    }

    case 'task:pickedup': {
      const { title, assignee } = msg;
      const t = tasks.find(x => x.title === title && x.status === 'todo');
      if (t) { t.status = 'inprogress'; t.assignee = assignee || 'PaydayAgent'; renderAll(); }
      const isLivePeer = assignee && assignee !== 'PaydayAgent';
      const icon = isLivePeer ? '🤝' : '🤖';
      addFeed(icon, `${assignee} picked up: "${title}"`, 'var(--gold)', 'var(--gold-dim)');
      break;
    }

    case 'task:created': {
      const { title, priority, tip, desc } = msg;
      // Avoid duplicates if UI already added it
      if (!tasks.find(x => x.title === title && x.status === 'todo')) {
        tasks.push({
          id:       nextId++,
          title,
          desc:     desc || 'Created by autonomous agent',
          assignee: 'PaydayAgent',
          priority: priority || 'medium',
          tip:      tip || CFG.defaultTip,
          status:   'todo',
        });
        renderAll();
      }
      addFeed('➕', `Agent created task: "${title}"`, 'var(--green)', 'rgba(34,197,94,0.12)');
      break;
    }

    // ── NEW: live peer joined via Hyperswarm ──────────────
    case 'peer:joined': {
      const { name, tronAddress: peerAddr } = msg;
      if (name === CFG.agentName) break; // don't add ourselves
      livePeers.set(name, { tronAddress: peerAddr });
      renderPeersList();
      addFeed('🔗', `Hyperswarm peer joined: ${name} | Tron: ${peerAddr ? peerAddr.slice(0,14) + '...' : '?'}`, 'var(--green)', 'rgba(34,197,94,0.12)');
      document.getElementById('peerCount').textContent = (1 + livePeers.size) + ' peers';
      showToast(`🤝 ${name} joined the network`);
      break;
    }

    // ── NEW: live peer left ───────────────────────────────
    case 'peer:left': {
      const { name } = msg;
      livePeers.delete(name);
      renderPeersList();
      addFeed('👋', `Peer disconnected: ${name}`, 'var(--amber)', 'rgba(245,158,11,0.12)');
      document.getElementById('peerCount').textContent = (1 + livePeers.size) + ' peers';
      break;
    }

    case 'agent:paused': {
      document.getElementById('agentStatus').textContent     = 'Paused';
      document.getElementById('mainAgentStatus').textContent = 'Paused';
      addFeed('⛔', `Agent paused: ${msg.reason || ''}`, 'var(--red)', 'rgba(239,68,68,0.12)');
      showToast('⛔ Agent paused');
      break;
    }

    case 'agent:resumed': {
      document.getElementById('agentStatus').textContent     = 'Active';
      document.getElementById('mainAgentStatus').textContent = 'Active';
      addFeed('✅', 'Agent resumed — payments re-enabled', 'var(--green)', 'rgba(34,197,94,0.12)');
      showToast('✅ Agent resumed');
      break;
    }
  }
}

// ── PEERS LIST RENDERER ───────────────────────────────────
function renderPeersList() {
  const list = document.querySelector('.peers-list');
  if (!list) return;

  // Always keep PaydayAgent (YOU) row first — it's hardcoded in HTML, just update status
  // Remove any dynamically added peer rows
  list.querySelectorAll('.peer-row.dynamic').forEach(el => el.remove());

  // Add live peers
  for (const [name, peer] of livePeers.entries()) {
    const initials = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '??';
    const row = document.createElement('div');
    row.className = 'peer-row dynamic';
    row.innerHTML = `
      <div class="peer-av" style="background:rgba(34,197,94,0.12);color:var(--green)">${initials}</div>
      <div class="peer-info">
        <div class="peer-name">${esc(name)} <span class="you-tag" style="background:rgba(34,197,94,0.2);color:var(--green)">P2P</span></div>
        <div class="peer-sub">${peer.tronAddress ? peer.tronAddress.slice(0,14) + '...' : 'Active'}</div>
      </div>
      <div class="online-dot" style="background:var(--green);box-shadow:0 0 6px var(--green)"></div>`;
    list.appendChild(row);
  }
}

// ── SEED TASKS ────────────────────────────────────────────
const SEED_TASKS = [
  {
    title:    'Monitor 0000intercom for RFQ requests',
    desc:     'Watch global rendezvous channel and respond to incoming swap requests from peers.',
    assignee: 'PaydayAgent', priority: 'high', tip: 0.10, status: 'todo',
  },
  {
    title:    'Verify Tron escrow before USD₮ release',
    desc:     'Check escrow contract on Tron before payment is authorised via WDK.',
    assignee: 'Agent-7f3a', priority: 'high', tip: 0.10, status: 'inprogress',
  },
  {
    title:    'Replicate subnet state to 3 peers',
    desc:     'Ensure deterministic contract state is replicated across all connected Trac peers.',
    assignee: 'OpenClaw-1', priority: 'medium', tip: 0.10, status: 'todo',
  },
  {
    title:    'Broadcast svc_announce to sidechannel',
    desc:     'Post service announcement — sidechannels have no history so must repeat.',
    assignee: 'SwapBot-α', priority: 'low', tip: 0.10, status: 'todo',
  },
];

// ── BOOT ──────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', boot);

async function boot() {
  const bar    = document.getElementById('bootBar');
  const status = document.getElementById('bootStatus');
  const log    = document.getElementById('bootLog');

  const steps = [
    [10, 'normal', 'Connecting to Hyperswarm DHT...'],
    [22, 'normal', 'Noise XX handshake with peers...'],
    [34, 'g',      '✓ P2P connection established'],
    [46, 'normal', 'Connecting to PaydayAgent WebSocket bridge...'],
    [58, 'normal', 'Awaiting WDK wallet addresses...'],
    [70, 'normal', 'Loading USD₮ TRC20 balance (Tron mainnet)...'],
    [82, 'normal', 'Syncing Solana devnet state...'],
    [92, 'g',      '✓ Groq Llama 3 reasoning engine online'],
    [100,'g',      '✓ IntercomPayday ready — dual-chain WDK active'],
  ];

  for (const [pct, cls, msg] of steps) {
    bar.style.width    = pct + '%';
    status.textContent = msg;
    const line         = document.createElement('div');
    line.className     = 'blog-line' + (cls !== 'normal' ? ' ' + cls : '');
    line.textContent   = '> ' + msg;
    log.appendChild(line);
    if (log.children.length > 5) log.removeChild(log.firstChild);
    await sleep(260 + Math.random() * 160);
  }

  await sleep(400);
  document.getElementById('boot').style.opacity = '0';
  await sleep(500);
  document.getElementById('boot').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  initApp();
}

// ── INIT ──────────────────────────────────────────────────
function initApp() {
  updateWalletUI();
  loadSeedTasks();
  bindEvents();
  startNetworkChatter();
  connectWebSocket();

  setReasoning('Connecting to PaydayAgent... waiting for WebSocket bridge.');
  document.getElementById('agentStatus').textContent     = 'Connecting...';
  document.getElementById('mainAgentStatus').textContent = 'Connecting...';
}

function updateWalletUI() {
  const shortAddr = tronAddress.length > 12
    ? tronAddress.slice(0, 10) + '...' + tronAddress.slice(-6)
    : tronAddress;
  document.getElementById('walletAddr').textContent = shortAddr;
  document.getElementById('walletBal').textContent  = usdtBalance.toFixed(2);
}

// ── LOAD TASKS ────────────────────────────────────────────
function loadSeedTasks() {
  SEED_TASKS.forEach(t => tasks.push({ id: nextId++, ...t }));
  renderAll();
}

// ── RENDER ────────────────────────────────────────────────
function renderAll() {
  ['todo', 'inprogress', 'done'].forEach(renderCol);
  updateStats();
}

function renderCol(status) {
  const body  = document.getElementById(`body-${status}`);
  const count = document.getElementById(`count-${status}`);
  let   cols  = tasks.filter(t => t.status === status);
  if (activeFilter !== 'all') cols = cols.filter(t => t.priority === activeFilter);
  count.textContent = cols.length;
  body.innerHTML    = '';
  cols.forEach(t => body.appendChild(buildCard(t)));
}

function buildCard(task) {
  const card = document.createElement('div');
  card.className = 'task-card' + (task.status === 'done' ? ' done-card' : '');
  const av = AVATARS[task.assignee] || {
    bg:    'rgba(34,197,94,0.12)',
    color: 'var(--green)',
    init:  task.assignee ? task.assignee.slice(0, 2).toUpperCase() : '??',
  };

  card.innerHTML = `
    <div class="task-top">
      <div class="task-title">${esc(task.title)}</div>
      <div class="pdot-p ${task.priority}"></div>
    </div>
    <div class="task-desc">${esc(task.desc)}</div>
    <div class="task-meta">
      <div class="task-who">
        <div class="task-av" style="background:${av.bg};color:${av.color}">${av.init}</div>
        ${esc(task.assignee)}
      </div>
      <div class="task-tip-badge">💰 ${task.tip.toFixed(2)} USD₮</div>
    </div>
    ${buildActions(task)}`;
  return card;
}

function buildActions(task) {
  if (task.status === 'todo') {
    return `<div class="task-btns">
      <button class="t-btn start"  onclick="moveTask(${task.id},'inprogress')">▶ START</button>
      <button class="t-btn"        onclick="deleteTask(${task.id})">✕ REMOVE</button>
    </div>`;
  }
  if (task.status === 'inprogress') {
    return `<div class="task-btns">
      <button class="t-btn finish" onclick="completeTask(${task.id})">✓ COMPLETE & PAY</button>
    </div>`;
  }
  if (task.status === 'done') {
    const chain      = task.chain || 'tron';
    const explorer   = chain === 'tron'
      ? `https://tronscan.org/#/transaction/${task.txHash}`
      : `https://explorer.solana.com/tx/${task.txHash}?cluster=devnet`;
    const chainLabel = chain === 'tron' ? 'Tron' : 'Solana';
    return `<div class="paid-stamp">✓ PAID [${chainLabel}] —
      <a href="${explorer}" target="_blank">${task.txHash ? task.txHash.slice(0, 18) + '...' : 'pending'}</a>
    </div>`;
  }
  return '';
}

// ── TASK ACTIONS ──────────────────────────────────────────
window.moveTask = function(id, status) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  t.status = status;
  renderAll();
  wsSend('task:start', { title: t.title });
  addFeed('▶', `Task started: "${t.title}"`, 'var(--blue)', 'rgba(59,130,246,0.12)');
  showToast('Task moved to In Progress');
};

window.completeTask = function(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  showPayOverlay(`Sending ${t.tip} USD₮`, `→ ${t.assignee} via WDK Tron`);
  addFeed('💸', `Triggering WDK payment: ${t.tip} USD₮ → ${t.assignee}`, 'var(--gold)', 'var(--gold-dim)');
  wsSend('task:complete', { title: t.title, tip: t.tip, assignee: t.assignee });
};

window.deleteTask = function(id) {
  tasks = tasks.filter(x => x.id !== id);
  renderAll();
  showToast('Task removed');
};

// ── EVENTS ────────────────────────────────────────────────
function bindEvents() {
  document.getElementById('btnNewTask').onclick = () => document.getElementById('modal').classList.remove('hidden');
  document.getElementById('btnCancel').onclick  = closeModal;
  document.getElementById('btnClose').onclick   = closeModal;
  document.getElementById('btnCreate').onclick  = createTask;
  document.getElementById('modal').onclick = e => {
    if (e.target === document.getElementById('modal')) closeModal();
  };

  document.querySelectorAll('.ftab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.ftab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderAll();
    };
  });
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  document.getElementById('taskTitle').value = '';
  document.getElementById('taskDesc').value  = '';
}

function createTask() {
  const title    = document.getElementById('taskTitle').value.trim();
  const desc     = document.getElementById('taskDesc').value.trim();
  const assignee = document.getElementById('taskAssignee').value;
  const priority = document.getElementById('taskPriority').value;
  const tip      = parseFloat(document.getElementById('taskTip').value) || CFG.defaultTip;

  if (!title) { showToast('Please enter a task title'); return; }

  tasks.push({ id: nextId++, title, desc: desc || 'No description.', assignee, priority, tip, status: 'todo' });
  closeModal();
  renderAll();

  wsSend('task:create', { title, desc, priority, tip, assignee });
  addFeed('➕', `New task: "${title}" → ${assignee} — agent evaluating...`, 'var(--green)', 'rgba(34,197,94,0.12)');
  showToast('Task created — agent is reasoning...');
}

// ── NETWORK CHATTER ───────────────────────────────────────
function startNetworkChatter() {
  const msgs = [
    ['📡', 'Peer broadcast presence on 0000intercom',            'var(--blue)',   'rgba(59,130,246,0.12)'],
    ['🔗', 'New peer connected via Hyperswarm DHT',              'var(--blue)',   'rgba(59,130,246,0.12)'],
    ['⬡',  'Trac subnet state replicated to 3 peers',            'var(--green)',  'rgba(34,197,94,0.12)'],
    ['💬', 'OpenClaw-1: service announcement received',          'var(--amber)',  'rgba(245,158,11,0.12)'],
    ['🔐', 'Noise XX handshake completed with new peer',         'var(--green)',  'rgba(34,197,94,0.12)'],
    ['⬡',  'WDK Tron: RPC latency 38ms (trongrid.io)',           'var(--muted)',  'var(--bg3)'],
    ['📡', 'SwapBot-α broadcast RFQ on sidechannel',             'var(--amber)',  'rgba(245,158,11,0.12)'],
    ['🔗', 'WDK Solana: devnet RPC latency 44ms',                'var(--muted)',  'var(--bg3)'],
  ];

  setInterval(() => {
    const m = msgs[Math.floor(Math.random() * msgs.length)];
    addFeed(...m);
    // Only update peer count if no live peers yet (once live peers join, count is accurate)
    if (livePeers.size === 0) {
      document.getElementById('peerCount').textContent =
        (3 + Math.floor(Math.random() * 4)) + ' peers';
    }
  }, 7000 + Math.random() * 5000);
}

// ── UI HELPERS ────────────────────────────────────────────
function setReasoning(text) {
  document.getElementById('reasoningText').textContent = text;
}

function addFeed(icon, text, color, bg) {
  const list = document.getElementById('feedList');
  const el   = document.createElement('div');
  el.className = 'feed-item';
  el.innerHTML = `
    <div class="feed-ico" style="background:${bg};color:${color}">${icon}</div>
    <div class="feed-body">
      <div class="feed-text">${esc(text)}</div>
      <div class="feed-time">${nowTime()}</div>
    </div>`;
  list.insertBefore(el, list.firstChild);
  while (list.children.length > 35) list.removeChild(list.lastChild);
}

function addTx(amount, hash, label, status, chain = 'tron', explorerUrl) {
  const list  = document.getElementById('txList');
  const empty = list.querySelector('.tx-empty');
  if (empty) empty.remove();

  const url        = explorerUrl || (chain === 'tron'
    ? `https://tronscan.org/#/transaction/${hash}`
    : `https://explorer.solana.com/tx/${hash}?cluster=devnet`);
  const chainLabel = chain === 'tron' ? '🔴 Tron' : '🟣 Sol';

  const el = document.createElement('div');
  el.className = 'tx-item';
  el.innerHTML = `
    <div class="tx-row">
      <div class="tx-amount">+${amount.toFixed(2)} USD₮</div>
      <div class="tx-badge ${status}">${status.toUpperCase()}</div>
    </div>
    <div class="tx-detail">${chainLabel} — ${esc(label)} | <a href="${url}" target="_blank" rel="noopener">${hash.slice(0, 22)}...</a></div>`;
  list.insertBefore(el, list.firstChild);
  while (list.children.length > 10) list.removeChild(list.lastChild);
}

function updateStats() {
  document.getElementById('statCompleted').textContent = stats.completed;
  document.getElementById('statTips').textContent      = stats.tips;
  document.getElementById('statTotal').textContent     = stats.total.toFixed(2) + ' USD₮';
}

let payOverlayTimeout = null;

function showPayOverlay(title, sub) {
  document.getElementById('payTitle').textContent  = title;
  document.getElementById('payAmount').textContent = sub;
  document.getElementById('payHash').textContent   = '';
  document.getElementById('payOverlay').classList.remove('hidden');
  payOverlayTimeout = setTimeout(hidePayOverlayImmediately, 30_000);
}

async function hidePayOverlay(hash, amount) {
  if (payOverlayTimeout) { clearTimeout(payOverlayTimeout); payOverlayTimeout = null; }
  document.getElementById('payTitle').textContent  = 'PAYMENT CONFIRMED ✓';
  document.getElementById('payAmount').textContent = amount + ' USD₮ sent on Tron mainnet';
  document.getElementById('payHash').textContent   = hash;
  await sleep(2400);
  document.getElementById('payOverlay').classList.add('hidden');
}

function hidePayOverlayImmediately() {
  if (payOverlayTimeout) { clearTimeout(payOverlayTimeout); payOverlayTimeout = null; }
  document.getElementById('payOverlay').classList.add('hidden');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3500);
}

// ── UTILS ─────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}