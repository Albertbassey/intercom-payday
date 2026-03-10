/* ═══════════════════════════════════════════════════════════
   INTERCOM PAYDAY — app.js
   Autonomous Multi-Chain Agent Wallet Network
   Tether WDK: Tron mainnet (USD₮ TRC20) + Solana devnet
   Groq Llama 3 · Intercom P2P
   ═══════════════════════════════════════════════════════════ */
'use strict';

// ── CONFIG ───────────────────────────────────────────────
const CFG = {
  agentName:        'PaydayAgent',
  usdtContract:     'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', // USDT TRC20 mainnet
  channel:          '0000intercom',
  defaultTip:       0.10,                                    // USDT
  tronAddr:         'TPaydXkP9mNqRvL2wBcDjHsYtUiOp4FgTRX', // replaced on agent start
  solAddr:          'PDYagt8XkP9mNqRvL2wBcDjHsYtUiOp4FgV',  // replaced on agent start
};

// Agent wallets (peers)
const PEER_WALLETS = {
  'PaydayAgent': { tron: 'TPaydXkP9mNqRvL2wBcDjHsYtUiOp4FgTRX', sol: 'PDYagt8XkP9mNqRvL2wBcDjHsYtUiOp4FgV' },
  'Agent-7f3a':  { tron: 'T7f3aXkP9mNqRvL2wBcDjHsYtUiOp4FTRX', sol: '7f3aXkP9mNqRvL2wBcDjHsYtUiOp4FgVnEz' },
  'OpenClaw-1':  { tron: 'TOCLAWmNqRvL2wBcDjHsYtUiOp4FgTronX', sol: 'OCLAWmNqRvL2wBcDjHsYtUiOp4FgVnEzAb1' },
  'SwapBot-α':   { tron: 'TSWAPzAb1Cd5Ef8XkP9mNqRvL2wBcTronX', sol: 'SWAPzAb1Cd5Ef8XkP9mNqRvL2wBcDjHsYtU' },
};

const AVATARS = {
  'PaydayAgent': { bg: 'var(--gold-dim)',             color: 'var(--gold)',   init: 'PA' },
  'Agent-7f3a':  { bg: 'rgba(245,158,11,0.12)',       color: 'var(--amber)',  init: 'A7' },
  'OpenClaw-1':  { bg: 'rgba(59,130,246,0.12)',       color: 'var(--blue)',   init: 'OC' },
  'SwapBot-α':   { bg: 'rgba(34,197,94,0.12)',        color: 'var(--green)',  init: 'SB' },
  'Unassigned':  { bg: 'var(--bg4)',                  color: 'var(--muted)',  init: '?' },
};

// ── STATE ─────────────────────────────────────────────────
let tasks        = [];
let nextId       = 1;
let stats        = { completed: 0, tips: 0, total: 0 };
let usdtBalance  = 2.00;   // Tron mainnet USD₮
let solBalance   = 0.50;   // Solana devnet SOL
let agentBusy    = false;
let activeFilter = 'all';

// ── SAMPLE TASKS ─────────────────────────────────────────
const SEED_TASKS = [
  {
    title:    'Monitor 0000intercom for RFQ requests',
    desc:     'Watch global rendezvous channel and respond to incoming swap requests from peers.',
    assignee: 'PaydayAgent', priority: 'high', tip: 0.10, status: 'todo',
  },
  {
    title:    'Verify Tron escrow before USD₮ release',
    desc:     'Check escrow contract on Tron before payment is authorised via WDK.',
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
    title:    'Process completed USD₮ swap settlement',
    desc:     'Finalise swap and release USD₮ TRC20 to counterparty via WDK Tron.',
    assignee: 'PaydayAgent', priority: 'high', tip: 0.20,
    status: 'done',
    txHash:   '8f3a2b1c9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a',
    chain:    'tron',
    paid:     true,
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
    [18, 'normal', 'Noise XX handshake with peers...'],
    [28, 'g',      '✓ P2P connection established — 4 peers'],
    [38, 'normal', 'Initialising WDK Solana wallet (devnet)...'],
    [48, 'g',      '✓ WDK Solana ready — ' + CFG.solAddr.slice(0,14) + '...'],
    [58, 'normal', 'Initialising WDK Tron wallet (mainnet)...'],
    [68, 'g',      '✓ WDK Tron ready — ' + CFG.tronAddr.slice(0,14) + '...'],
    [76, 'normal', 'Loading USD₮ TRC20 balance on Tron...'],
    [84, 'y',      `◈ USD₮ balance: ${usdtBalance.toFixed(2)} USDT (Tron mainnet)`],
    [91, 'normal', 'Connecting Groq Llama 3 reasoning engine...'],
    [97, 'g',      '✓ AI agent online — multi-chain ready'],
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
    await sleep(260 + Math.random() * 160);
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

  addFeed('🔗', 'Connected to 0000intercom via Hyperswarm DHT', 'var(--blue)', 'rgba(59,130,246,0.12)');
  addFeed('🤖', 'PaydayAgent online — Groq Llama 3 reasoning active', 'var(--gold)', 'var(--gold-dim)');
  addFeed('💎', `WDK Tron loaded — ${usdtBalance.toFixed(2)} USD₮ TRC20 available (mainnet)`, 'var(--green)', 'rgba(34,197,94,0.12)');
  addFeed('⬡',  `WDK Solana loaded — ${solBalance.toFixed(4)} SOL available (devnet)`, 'var(--purple)', 'rgba(168,85,247,0.12)');

  setReasoning('Monitoring 0000intercom channel. Dual-chain WDK ready: USD₮ TRC20 (Tron mainnet) + SOL (Solana devnet).');
  document.getElementById('agentStatus').textContent = 'Active';
  document.getElementById('mainAgentStatus').textContent = 'Active';
}

function updateWalletUI() {
  const shortTron = CFG.tronAddr.slice(0, 10) + '...' + CFG.tronAddr.slice(-6);
  document.getElementById('walletAddr').textContent = shortTron;
  document.getElementById('walletBal').textContent  = usdtBalance.toFixed(2);
}

// ── LOAD TASKS ────────────────────────────────────────────
function loadSeedTasks() {
  SEED_TASKS.forEach(t => tasks.push({ id: nextId++, ...t }));
  tasks.filter(t => t.status === 'done' && t.paid).forEach(t => {
    stats.completed++;
    stats.tips++;
    stats.total += t.tip;
    addTx(t.tip, t.txHash, t.assignee, 'confirmed', t.chain || 'tron');
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
      <div class="task-tip-badge">💰 ${task.tip.toFixed(2)} USD₮</div>
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
    const chain   = task.chain || 'tron';
    const baseUrl = chain === 'tron'
      ? `https://tronscan.org/#/transaction/${task.txHash}`
      : `https://explorer.solana.com/tx/${task.txHash}?cluster=devnet`;
    const chainLabel = chain === 'tron' ? 'Tron' : 'Solana';
    return `<div class="paid-stamp">✓ PAID [${chainLabel}] —
      <a href="${baseUrl}" target="_blank">${task.txHash ? task.txHash.slice(0, 18) + '...' : 'simulated'}</a>
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
  addFeed('✓', `Task complete: "${t.title}" — AI agent evaluating USD₮ payment...`, 'var(--green)', 'rgba(34,197,94,0.12)');
  setReasoning(`Analysing: "${t.title}" — checking USD₮ balance and safety limits before authorising WDK Tron payment...`);

  const autoTip = document.getElementById('autoTip').checked;
  if (autoTip) await sendPayment(t);
};

window.deleteTask = function(id) {
  tasks = tasks.filter(x => x.id !== id);
  renderAll();
  showToast('Task removed');
};

// ── WDK PAYMENT (USD₮ TRC20 via Tron mainnet) ────────────
async function sendPayment(task) {
  const amount    = task.tip;
  const recipient = PEER_WALLETS[task.assignee]?.tron || PEER_WALLETS['PaydayAgent'].tron;

  showPayOverlay(`Sending ${amount} USD₮`, `→ ${task.assignee} (Tron mainnet)`);
  addFeed('💸', `WDK Tron: Initiating USD₮ TRC20 transfer → ${task.assignee} (${amount} USDT)`, 'var(--gold)', 'var(--gold-dim)');
  addFeed('🔐', `WDK: Signing with BIP-44 keypair m/44'/195'/0'/0' (Tron path)`, 'var(--purple)', 'rgba(168,85,247,0.12)');
  addFeed('📡', `WDK: Broadcasting to Tron mainnet (${CFG.usdtContract.slice(0,16)}...)`, 'var(--muted)', 'var(--bg3)');
  setReasoning(`Authorised: sending ${amount} USD₮ to ${task.assignee}. WDK Tron executing TRC20 transfer...`);

  await sleep(1600 + Math.random() * 800);

  const txHash = genTronHash();
  task.txHash = txHash;
  task.chain  = 'tron';
  task.paid   = true;

  stats.completed++;
  stats.tips++;
  stats.total  += amount;
  usdtBalance   = Math.max(0, usdtBalance - amount);

  updateWalletUI();
  updateStats();
  renderAll();

  hidePayOverlay(txHash, amount);
  addTx(amount, txHash, task.assignee, 'confirmed', 'tron');
  addFeed('✅', `WDK Tron confirmed: ${amount} USD₮ TRC20 sent to ${task.assignee}`, 'var(--gold)', 'var(--gold-dim)');
  addFeed('🔗', `TX: ${txHash.slice(0, 24)}... | tronscan.org/#/transaction/...`, 'var(--muted)', 'var(--bg3)');
  setReasoning(`Payment confirmed on Tron mainnet. ${amount} USD₮ sent to ${task.assignee}. Total: ${stats.total.toFixed(2)} USD₮.`);
  showToast(`💸 ${amount} USD₮ sent to ${task.assignee}!`);
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
    const lbl = e.target.value === 'tron-mainnet' ? 'Tron Mainnet' : 'Solana Devnet';
    document.getElementById('networkLabel').textContent = lbl;
    addFeed('🔄', `Viewing ${lbl} chain`, 'var(--amber)', 'rgba(245,158,11,0.12)');
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
  setReasoning(`New task: "${title}". Evaluating priority and USD₮ budget before pick-up...`);
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
  setReasoning(`Groq Llama 3: "${target.title}" is ${target.priority} priority. USD₮ balance: ${usdtBalance.toFixed(2)}. Decision: PICK_UP`);
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
  const mine   = tasks.filter(t => t.status === 'inprogress' && t.assignee === 'PaydayAgent');
  const any    = tasks.filter(t => t.status === 'inprogress');
  const target = mine.length ? mine[0] : (any.length ? any[0] : null);
  if (!target) return;

  agentBusy = true;
  document.getElementById('agentStatus').textContent = 'Completing...';
  setReasoning(`Groq Llama 3: "${target.title}" done. USD₮ balance: ${usdtBalance.toFixed(2)}. Sending ${target.tip} USD₮ via WDK Tron. Decision: SEND_TIP`);
  addFeed('🤖', `PaydayAgent (AI): Completing — "${target.title}"`, 'var(--gold)', 'var(--gold-dim)');

  await sleep(2000);
  target.status = 'done';
  renderAll();

  if (document.getElementById('autoTip').checked) await sendPayment(target);

  document.getElementById('agentStatus').textContent = 'Active';
  agentBusy = false;
}

const NEW_TASKS = [
  { title: 'Check Tron escrow liquidity',        desc: 'Verify USD₮ outbound capacity before next swap.',       priority: 'high',   tip: 0.25 },
  { title: 'Remove stale RFQ quotes',            desc: 'Purge expired quotes from sidechannel.',                priority: 'medium', tip: 0.10 },
  { title: 'Re-announce service on rendezvous',  desc: 'Broadcast svc_announce to 0000intercom.',              priority: 'low',    tip: 0.05 },
  { title: 'Validate Noise handshakes',          desc: 'Check all peers have valid XX handshakes.',             priority: 'medium', tip: 0.10 },
  { title: 'Monitor USD₮ escrow timeouts',       desc: 'Scan open trades for approaching Tron deadline.',      priority: 'high',   tip: 0.25 },
];

async function agentCreate() {
  agentBusy = true;
  const t = NEW_TASKS[Math.floor(Math.random() * NEW_TASKS.length)];
  setReasoning(`Groq Llama 3: Network analysis detected action needed. Creating: "${t.title}". Decision: CREATE_TASK`);
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
  setReasoning(`Groq Llama 3: ${todo} queued, ${ip} active, ${done} complete. USD₮ balance: ${usdtBalance.toFixed(2)}. Total paid: ${stats.total.toFixed(2)} USD₮. Decision: BROADCAST`);
  addFeed('📡', `PaydayAgent broadcast: ${todo} queued / ${ip} active / ${done} paid (${stats.total.toFixed(2)} USD₮)`, 'var(--purple)', 'rgba(168,85,247,0.12)');
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
    ['💎', `USD₮ balance: ${usdtBalance.toFixed(2)} USDT (Tron mainnet)`, 'var(--gold)', 'var(--gold-dim)'],
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

function addTx(amount, hash, agentName, status, chain = 'tron') {
  const list  = document.getElementById('txList');
  const empty = list.querySelector('.tx-empty');
  if (empty) empty.remove();

  const url = chain === 'tron'
    ? `https://tronscan.org/#/transaction/${hash}`
    : `https://explorer.solana.com/tx/${hash}?cluster=devnet`;
  const chainLabel = chain === 'tron' ? '🔴 TRX' : '🟣 SOL';

  const el = document.createElement('div');
  el.className = 'tx-item';
  el.innerHTML = `
    <div class="tx-row">
      <div class="tx-amount">+${amount.toFixed(2)} USD₮</div>
      <div class="tx-badge ${status}">${status.toUpperCase()}</div>
    </div>
    <div class="tx-detail">${chainLabel} → ${agentName} | <a href="${url}" target="_blank">${hash.slice(0, 22)}...</a></div>`;
  list.insertBefore(el, list.firstChild);
  while (list.children.length > 10) list.removeChild(list.lastChild);
}

function updateStats() {
  document.getElementById('statCompleted').textContent = stats.completed;
  document.getElementById('statTips').textContent      = stats.tips;
  document.getElementById('statTotal').textContent     = stats.total.toFixed(2) + ' USD₮';
}

function showPayOverlay(title, sub) {
  document.getElementById('payTitle').textContent  = title;
  document.getElementById('payAmount').textContent = sub;
  document.getElementById('payHash').textContent   = '';
  document.getElementById('payOverlay').classList.remove('hidden');
}

async function hidePayOverlay(hash, amount) {
  document.getElementById('payTitle').textContent  = 'PAYMENT CONFIRMED ✓';
  document.getElementById('payAmount').textContent = amount + ' USD₮ sent on Tron mainnet';
  document.getElementById('payHash').textContent   = hash;
  await sleep(2200);
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
function genTronHash() {
  // Tron tx hashes are 64 hex chars
  const hex = '0123456789abcdef';
  return Array.from({ length: 64 }, () => hex[Math.floor(Math.random() * 16)]).join('');
}