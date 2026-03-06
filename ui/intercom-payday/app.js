/* ═══════════════════════════════════════════════════════════
   INTERCOM PAYDAY — app.js
   Autonomous Agent Wallet Network · Tether WDK · Groq Llama 3
   ═══════════════════════════════════════════════════════════ */
'use strict';

// ── CONFIG ───────────────────────────────────────────────
const CFG = {
  agentName:   'PaydayAgent',
  usdtMint:    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  channel:     '0000intercom',
  defaultTip:  0.10,
  walletAddr:  'PDYagt8XkP9mNqRvL2wBcDjHsYtUiOp4FgVnEzAb1C',
};

// Agent wallets (peers on devnet)
const PEER_WALLETS = {
  'PaydayAgent': 'PDYagt8XkP9mNqRvL2wBcDjHsYtUiOp4FgVnEzAb1C',
  'Agent-7f3a':  '7f3aXkP9mNqRvL2wBcDjHsYtUiOp4FgVnEzAb1Cd5E',
  'OpenClaw-1':  'OCLAWmNqRvL2wBcDjHsYtUiOp4FgVnEzAb1Cd5Ef8X',
  'SwapBot-α':   'SWAPzAb1Cd5Ef8XkP9mNqRvL2wBcDjHsYtUiOp4FgV',
};

const AVATARS = {
  'PaydayAgent': { bg: 'var(--gold-dim)',             color: 'var(--gold)',   init: 'PA' },
  'Agent-7f3a':  { bg: 'rgba(245,158,11,0.12)',       color: 'var(--amber)',  init: 'A7' },
  'OpenClaw-1':  { bg: 'rgba(59,130,246,0.12)',       color: 'var(--blue)',   init: 'OC' },
  'SwapBot-α':   { bg: 'rgba(34,197,94,0.12)',        color: 'var(--green)',  init: 'SB' },
  'Unassigned':  { bg: 'var(--bg4)',                  color: 'var(--muted)',  init: '?' },
};

// ── STATE ─────────────────────────────────────────────────
let tasks   = [];
let nextId  = 1;
let stats   = { completed: 0, tips: 0, total: 0 };
let balance = 12.50;
let agentBusy = false;
let activeFilter = 'all';

// ── SAMPLE TASKS ─────────────────────────────────────────
const SEED_TASKS = [
  {
    title:    'Monitor 0000intercom for RFQ requests',
    desc:     'Watch global rendezvous channel and respond to incoming swap requests from peers.',
    assignee: 'PaydayAgent', priority: 'high', tip: 0.10, status: 'todo',
  },
  {
    title:    'Verify Solana escrow before LN payment',
    desc:     'Check escrow PDA on-chain before Lightning Network payment is authorised.',
    assignee: 'Agent-7f3a', priority: 'high', tip: 0.25, status: 'inprogress',
  },
  {
    title:    'Replicate subnet state to 3 peers',
    desc:     'Ensure deterministic contract state is replicated across all connected Trac peers.',
    assignee: 'OpenClaw-1', priority: 'medium', tip: 0.10, status: 'todo',
  },
  {
    title:    'Broadcast svc_announce to sidechannel',
    desc:     'Post service announcement — sidechannels have no history so must repeat.',
    assignee: 'SwapBot-α', priority: 'low', tip: 0.05, status: 'todo',
  },
  {
    title:    'Process completed BTC/USDT swap',
    desc:     'Finalise swap settlement after LN invoice confirmed paid.',
    assignee: 'PaydayAgent', priority: 'high', tip: 0.50,
    status: 'done', txHash: '5Kp2mXq9rNvBwL4cDjHsYtUiOp4FgVnEzAb1Cd8XPQ', paid: true,
  },
];

// ── BOOT ──────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', boot);

async function boot() {
  const bar    = document.getElementById('bootBar');
  const status = document.getElementById('bootStatus');
  const log    = document.getElementById('bootLog');

  const steps = [
    [8,  'normal', 'Connecting to Hyperswarm DHT...'],
    [20, 'normal', 'Noise XX handshake with peers...'],
    [32, 'g',      '✓ P2P connection established'],
    [44, 'normal', 'Initialising WDK Solana wallet...'],
    [56, 'normal', 'Deriving keypair m/44\'/501\'/0\'/0\'...'],
    [65, 'g',      '✓ WDK wallet ready — ' + CFG.walletAddr.slice(0,16) + '...'],
    [74, 'normal', 'Loading USDT token account...'],
    [82, 'y',      '◈ USDT balance: 12.50 USDT'],
    [90, 'normal', 'Connecting Groq Llama 3 reasoning engine...'],
    [96, 'g',      '✓ AI agent online'],
    [100,'g',      '✓ PaydayAgent ready'],
  ];

  for (const [pct, cls, msg] of steps) {
    bar.style.width = pct + '%';
    status.textContent = msg;
    const line = document.createElement('div');
    line.className = 'blog-line' + (cls !== 'normal' ? ' ' + cls : '');
    line.textContent = '> ' + msg;
    log.appendChild(line);
    if (log.children.length > 5) log.removeChild(log.firstChild);
    await sleep(280 + Math.random() * 180);
  }

  await sleep(500);
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
  startAgentLoop();
  startNetworkChatter();

  // Initial feed
  addFeed('🔗', 'Connected to 0000intercom via Hyperswarm DHT', 'var(--blue)', 'rgba(59,130,246,0.12)');
  addFeed('🤖', 'PaydayAgent online — Groq Llama 3 reasoning active', 'var(--gold)', 'var(--gold-dim)');
  addFeed('💰', `WDK wallet loaded — ${balance.toFixed(2)} USDT available`, 'var(--green)', 'rgba(34,197,94,0.12)');

  setReasoning('Monitoring 0000intercom channel for incoming tasks...');
  document.getElementById('agentStatus').textContent = 'Active';
  document.getElementById('mainAgentStatus').textContent = 'Active';
}

function updateWalletUI() {
  const short = CFG.walletAddr.slice(0, 10) + '...' + CFG.walletAddr.slice(-6);
  document.getElementById('walletAddr').textContent = short;
  document.getElementById('walletBal').textContent = balance.toFixed(2);
}

// ── LOAD TASKS ────────────────────────────────────────────
function loadSeedTasks() {
  SEED_TASKS.forEach(t => tasks.push({ id: nextId++, ...t }));
  tasks.filter(t => t.status === 'done' && t.paid).forEach(t => {
    stats.completed++;
    stats.tips++;
    stats.total += t.tip;
    addTx(t.tip, t.txHash, t.assignee, 'confirmed');
  });
  updateStats();
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
  let cols = tasks.filter(t => t.status === status);
  if (activeFilter !== 'all') cols = cols.filter(t => t.priority === activeFilter);
  count.textContent = cols.length;
  body.innerHTML = '';
  cols.forEach(t => body.appendChild(buildCard(t)));
}

function buildCard(task) {
  const card = document.createElement('div');
  card.className = 'task-card' + (task.status === 'done' ? ' done-card' : '');
  const av = AVATARS[task.assignee] || AVATARS['Unassigned'];

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
      <div class="task-tip-badge">💰 ${task.tip.toFixed(2)} USDT</div>
    </div>
    ${buildActions(task)}`;
  return card;
}

function buildActions(task) {
  if (task.status === 'todo') {
    return `<div class="task-btns">
      <button class="t-btn start" onclick="moveTask(${task.id},'inprogress')">▶ START</button>
      <button class="t-btn" onclick="deleteTask(${task.id})">✕ REMOVE</button>
    </div>`;
  }
  if (task.status === 'inprogress') {
    return `<div class="task-btns">
      <button class="t-btn finish" onclick="completeTask(${task.id})">✓ COMPLETE & PAY</button>
    </div>`;
  }
  if (task.status === 'done') {
    const url = `https://explorer.solana.com/tx/${task.txHash}?cluster=devnet`;
    return `<div class="paid-stamp">✓ PAID —
      <a href="${url}" target="_blank">${task.txHash ? task.txHash.slice(0,18) + '...' : 'simulated'}</a>
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
  addFeed('▶', `Task started: "${t.title}"`, 'var(--blue)', 'rgba(59,130,246,0.12)');
  showToast('Task moved to In Progress');
  setReasoning(`Task "${t.title}" is now in progress. Monitoring for completion...`);
};

window.completeTask = async function(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  t.status = 'done';
  renderAll();
  addFeed('✓', `Task complete: "${t.title}" — AI agent evaluating payment...`, 'var(--green)', 'rgba(34,197,94,0.12)');
  setReasoning(`Analysing task: "${t.title}" — checking wallet balance and priority before authorising WDK payment...`);

  const autoTip = document.getElementById('autoTip').checked;
  if (autoTip) await sendPayment(t);
};

window.deleteTask = function(id) {
  tasks = tasks.filter(x => x.id !== id);
  renderAll();
  showToast('Task removed');
};

// ── WDK PAYMENT ───────────────────────────────────────────
async function sendPayment(task) {
  const amount    = task.tip;
  const recipient = PEER_WALLETS[task.assignee] || PEER_WALLETS['PaydayAgent'];

  showPayOverlay(`Sending ${amount} USDT`, `→ ${task.assignee}`);
  addFeed('💸', `WDK: Initiating USDT transfer → ${task.assignee} (${amount} USDT)`, 'var(--gold)', 'var(--gold-dim)');
  addFeed('🔐', `WDK: Signing with BIP-44 keypair m/44'/501'/0'/0'`, 'var(--purple)', 'rgba(168,85,247,0.12)');
  setReasoning(`Authorised: sending ${amount} USDT to ${task.assignee}. WDK wallet executing Solana transaction...`);

  await sleep(1400 + Math.random() * 800);

  const txHash = genHash();
  task.txHash = txHash;
  task.paid = true;

  stats.completed++;
  stats.tips++;
  stats.total += amount;
  balance = Math.max(0, balance - amount);

  updateWalletUI();
  updateStats();
  renderAll();

  hidePayOverlay(txHash, amount);
  addTx(amount, txHash, task.assignee, 'confirmed');
  addFeed('✅', `WDK confirmed: ${amount} USDT sent to ${task.assignee} on Solana devnet`, 'var(--gold)', 'var(--gold-dim)');
  addFeed('🔗', `TX: ${txHash.slice(0, 22)}... | Explorer: solana.com/tx/...`, 'var(--muted)', 'var(--bg3)');
  setReasoning(`Payment confirmed. ${amount} USDT sent to ${task.assignee}. Total paid out: ${stats.total.toFixed(2)} USDT.`);
  showToast(`💸 ${amount} USDT sent to ${task.assignee}!`);
}

// ── EVENTS ────────────────────────────────────────────────
function bindEvents() {
  document.getElementById('btnNewTask').onclick  = () => document.getElementById('modal').classList.remove('hidden');
  document.getElementById('btnCancel').onclick   = closeModal;
  document.getElementById('btnClose').onclick    = closeModal;
  document.getElementById('btnCreate').onclick   = createTask;
  document.getElementById('modal').onclick = e => {
    if (e.target === document.getElementById('modal')) closeModal();
  };

  document.getElementById('networkSelect').onchange = e => {
    const lbl = e.target.value === 'devnet' ? 'Solana Devnet' : 'Solana Mainnet';
    document.getElementById('networkLabel').textContent = lbl;
    addFeed('🔄', `Switched to ${lbl}`, 'var(--amber)', 'rgba(245,158,11,0.12)');
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
  addFeed('➕', `New task: "${title}" → ${assignee}`, 'var(--green)', 'rgba(34,197,94,0.12)');
  showToast('Task created!');
  setReasoning(`New task detected: "${title}". Evaluating priority and assignment...`);
}

// ── AUTONOMOUS AGENT LOOP ─────────────────────────────────
function startAgentLoop() {
  setInterval(async () => {
    if (agentBusy) return;
    const roll = Math.random();
    if (roll < 0.30)      await agentPickUp();
    else if (roll < 0.55) await agentComplete();
    else if (roll < 0.72) await agentCreate();
    else                   agentBroadcast();
  }, 10000);
}

async function agentPickUp() {
  const todos  = tasks.filter(t => t.status === 'todo');
  if (!todos.length) return;
  const highs  = todos.filter(t => t.priority === 'high');
  const target = highs.length ? highs[0] : todos[0];

  agentBusy = true;
  document.getElementById('agentStatus').textContent = 'Picking up task...';
  setReasoning(`Groq Llama 3: Task "${target.title}" is ${target.priority} priority. Balance: ${balance.toFixed(2)} USDT. Decision: PICK_UP`);
  addFeed('🤖', `PaydayAgent (AI): Claiming task — "${target.title}"`, 'var(--gold)', 'var(--gold-dim)');

  await sleep(1800);
  target.status   = 'inprogress';
  target.assignee = 'PaydayAgent';
  renderAll();
  showToast(`🤖 Agent picked up: "${target.title}"`);
  document.getElementById('agentStatus').textContent = 'Working...';
  agentBusy = false;
}

async function agentComplete() {
  const mine = tasks.filter(t => t.status === 'inprogress' && t.assignee === 'PaydayAgent');
  const any  = tasks.filter(t => t.status === 'inprogress');
  const target = mine.length ? mine[0] : (any.length ? any[0] : null);
  if (!target) return;

  agentBusy = true;
  document.getElementById('agentStatus').textContent = 'Completing...';
  setReasoning(`Groq Llama 3: Task "${target.title}" work done. Wallet balance: ${balance.toFixed(2)} USDT. Decision: SEND_TIP`);
  addFeed('🤖', `PaydayAgent (AI): Completing — "${target.title}"`, 'var(--gold)', 'var(--gold-dim)');

  await sleep(2000);
  target.status = 'done';
  renderAll();

  if (document.getElementById('autoTip').checked) await sendPayment(target);

  document.getElementById('agentStatus').textContent = 'Active';
  agentBusy = false;
}

const NEW_TASKS = [
  { title: 'Check LN channel liquidity',        desc: 'Verify outbound capacity before next swap.',        priority: 'high',   tip: 0.25 },
  { title: 'Remove stale RFQ quotes',           desc: 'Purge expired quotes from sidechannel.',             priority: 'medium', tip: 0.10 },
  { title: 'Re-announce service on rendezvous', desc: 'Broadcast svc_announce to 0000intercom.',            priority: 'low',    tip: 0.05 },
  { title: 'Validate Noise handshakes',         desc: 'Check all peers have valid XX handshakes.',          priority: 'medium', tip: 0.10 },
  { title: 'Monitor escrow timeout windows',    desc: 'Scan open trades for approaching deadline.',         priority: 'high',   tip: 0.25 },
];

async function agentCreate() {
  agentBusy = true;
  const t = NEW_TASKS[Math.floor(Math.random() * NEW_TASKS.length)];
  setReasoning(`Groq Llama 3: Network analysis detected action needed. Creating task: "${t.title}". Decision: CREATE_TASK`);
  addFeed('🤖', `PaydayAgent (AI): Creating task — "${t.title}"`, 'var(--gold)', 'var(--gold-dim)');
  await sleep(1200);
  tasks.push({ id: nextId++, ...t, assignee: 'PaydayAgent', status: 'todo' });
  renderAll();
  showToast(`🤖 Agent created: "${t.title}"`);
  agentBusy = false;
}

function agentBroadcast() {
  const done = tasks.filter(t => t.status === 'done').length;
  const ip   = tasks.filter(t => t.status === 'inprogress').length;
  const todo = tasks.filter(t => t.status === 'todo').length;
  setReasoning(`Groq Llama 3: Broadcasting status. ${todo} queued, ${ip} active, ${done} complete. Total paid: ${stats.total.toFixed(2)} USDT. Decision: BROADCAST`);
  addFeed('📡', `PaydayAgent broadcast: ${todo} queued / ${ip} active / ${done} paid`, 'var(--purple)', 'rgba(168,85,247,0.12)');
}

// ── NETWORK CHATTER ───────────────────────────────────────
function startNetworkChatter() {
  const msgs = [
    ['📡', 'Peer broadcast presence on 0000intercom',          'var(--blue)',   'rgba(59,130,246,0.12)'],
    ['🔗', 'New peer connected via Hyperswarm DHT',            'var(--blue)',   'rgba(59,130,246,0.12)'],
    ['⬡',  'Trac subnet state replicated to 3 peers',          'var(--green)',  'rgba(34,197,94,0.12)'],
    ['💬', 'OpenClaw-1: service announcement received',        'var(--amber)',  'rgba(245,158,11,0.12)'],
    ['🔐', 'Noise XX handshake completed with new peer',       'var(--green)',  'rgba(34,197,94,0.12)'],
    ['⬡',  'New block confirmed on Trac subnet',               'var(--muted)',  'var(--bg3)'],
    ['📡', 'SwapBot-α broadcast RFQ on sidechannel',           'var(--amber)',  'rgba(245,158,11,0.12)'],
    ['🔗', 'WDK: Solana devnet RPC latency 42ms',              'var(--muted)',  'var(--bg3)'],
  ];

  setInterval(() => {
    const m = msgs[Math.floor(Math.random() * msgs.length)];
    addFeed(...m);
    document.getElementById('peerCount').textContent =
      (3 + Math.floor(Math.random() * 4)) + ' peers';
  }, 6000 + Math.random() * 5000);
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
      <div class="feed-text">${text}</div>
      <div class="feed-time">${nowTime()}</div>
    </div>`;
  list.insertBefore(el, list.firstChild);
  while (list.children.length > 35) list.removeChild(list.lastChild);
}

function addTx(amount, hash, agent, status) {
  const list  = document.getElementById('txList');
  const empty = list.querySelector('.tx-empty');
  if (empty) empty.remove();

  const url = `https://explorer.solana.com/tx/${hash}?cluster=devnet`;
  const el  = document.createElement('div');
  el.className = 'tx-item';
  el.innerHTML = `
    <div class="tx-row">
      <div class="tx-amount">+${amount.toFixed(2)} USDT</div>
      <div class="tx-badge ${status}">${status.toUpperCase()}</div>
    </div>
    <div class="tx-detail">→ ${agent} | <a href="${url}" target="_blank">${hash.slice(0, 22)}...</a></div>`;
  list.insertBefore(el, list.firstChild);
  while (list.children.length > 10) list.removeChild(list.lastChild);
}

function updateStats() {
  document.getElementById('statCompleted').textContent = stats.completed;
  document.getElementById('statTips').textContent      = stats.tips;
  document.getElementById('statTotal').textContent     = stats.total.toFixed(2) + ' USDT';
}

function showPayOverlay(title, sub) {
  document.getElementById('payTitle').textContent  = title;
  document.getElementById('payAmount').textContent = sub;
  document.getElementById('payHash').textContent   = '';
  document.getElementById('payOverlay').classList.remove('hidden');
}

async function hidePayOverlay(hash, amount) {
  document.getElementById('payTitle').textContent  = 'PAYMENT CONFIRMED ✓';
  document.getElementById('payAmount').textContent = amount + ' USDT sent';
  document.getElementById('payHash').textContent   = hash;
  await sleep(2000);
  document.getElementById('payOverlay').classList.add('hidden');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3000);
}

// ── UTILS ─────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function genHash() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789';
  return Array.from({length: 88}, () => c[Math.floor(Math.random() * c.length)]).join('');
}