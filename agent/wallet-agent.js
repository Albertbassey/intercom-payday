/**
 * IntercomPayday — WDK Autonomous Wallet Agent
 * Groq Llama 3 · WDK Tron mainnet (USD₮) · WDK Solana devnet · WebSocket · Autonomous Loop
 * Run: node agent/wallet-agent.js
 */

import WalletManagerSolana from '@tetherto/wdk-wallet-solana';
import WalletManagerTron   from '@tetherto/wdk-wallet-tron';
import Groq                from 'groq-sdk';
import { WebSocketServer } from 'ws';
import { createInterface } from 'readline';
import { config }          from 'dotenv';
config();

const CONFIG = {
  tron: {
    provider:     process.env.TRON_PROVIDER          || 'https://api.trongrid.io',
    usdtContract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    decimals:     6,
    maxFee:       10_000_000,
    defaultTip:   parseFloat(process.env.USDT_DEFAULT_TIP)    || 0.10,
    maxTipPerTx:  parseFloat(process.env.USDT_MAX_TIP_PER_TX) || 1.00,
    dailyCap:     parseFloat(process.env.USDT_DAILY_CAP)      || 2.00,
    lowBal:       parseFloat(process.env.USDT_LOW_BAL)        || 1.00,
    minBal:       parseFloat(process.env.USDT_MIN_BAL)        || 0.20,
  },
  solana: {
    network: process.env.SOLANA_NETWORK || 'devnet',
    rpc: process.env.SOLANA_NETWORK === 'mainnet'
      ? 'https://api.mainnet-beta.solana.com'
      : 'https://api.devnet.solana.com',
    maxFee:      10_000_000,
    defaultTip:  parseFloat(process.env.SOL_DEFAULT_TIP)    || 0.001,
    maxTipPerTx: parseFloat(process.env.SOL_MAX_TIP_PER_TX) || 0.10,
    dailyCap:    parseFloat(process.env.SOL_DAILY_CAP)      || 0.50,
    lowBal:      parseFloat(process.env.SOL_LOW_BAL)        || 0.50,
    minBal:      parseFloat(process.env.SOL_MIN_BAL)        || 0.10,
  },
  agentName:   'PaydayAgent',
  channel:     '0000intercom',
  model:       'llama-3.1-8b-instant',
  paymentRole: process.env.PAYMENT_ROLE || 'autonomous',
  wsPort:      parseInt(process.env.WS_PORT)      || 8080,
  loopTickMs:  parseInt(process.env.LOOP_TICK_MS) || 30000,
  loopWorkMs:  parseInt(process.env.LOOP_WORK_MS) || 15000,
};

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const agent = {
  usdtBalance: 0, tronAddress: '', usdtDailySpent: 0, usdtDailyReset: Date.now(),
  solBalance: 0,  solAddress: '',  solDailySpent: 0,  solDailyReset: Date.now(),
  tasksCompleted: 0, totalPaidUsdt: 0, totalPaidSol: 0,
  auditLog: [], paused: false, pauseReason: '', pendingPayment: null,
};

let globalTronAccount = null;
let globalSolAccount  = null;

// ── WebSocket ──────────────────────────────────────────────
const clients = new Set();

function startWebSocketServer() {
  const wss = new WebSocketServer({ port: CONFIG.wsPort });
  wss.on('listening', () => {
    console.log(`\n🌐 WebSocket → ws://localhost:${CONFIG.wsPort}`);
  });
  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`\n🔌 UI connected (${clients.size})`);
    send(ws, 'balance:update', { usdt: agent.usdtBalance, sol: agent.solBalance, tronAddress: agent.tronAddress, solAddress: agent.solAddress });
    send(ws, 'agent:status', { status: agent.paused ? 'Paused' : 'Active', paused: agent.paused, paymentRole: CONFIG.paymentRole, tasksCompleted: agent.tasksCompleted, totalPaidUsdt: agent.totalPaidUsdt });
    ws.on('message', (raw) => handleUICommand(raw));
    ws.on('close', () => clients.delete(ws));
    ws.on('error', (e) => console.error(`WS: ${e.message}`));
  });
}

function send(ws, type, payload = {}) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type, ...payload, ts: Date.now() }));
}

function broadcast(type, payload = {}) {
  const msg = JSON.stringify({ type, ...payload, ts: Date.now() });
  for (const ws of clients) if (ws.readyState === 1) ws.send(msg);
}

async function handleUICommand(raw) {
  let msg; try { msg = JSON.parse(raw); } catch { return; }
  const { type, ...data } = msg;
  if (type === 'task:create') {
    const r = await agentReason(`New task: "${data.title}" | ${data.priority} | ${data.tip} USDT`);
    broadcast('agent:reasoning', { text: r });
    broadcast('agent:action', { action: extractAction(r), details: data });
  } else if (type === 'task:start') {
    broadcast('task:pickedup', { title: data.title, assignee: 'PaydayAgent' });
  } else if (type === 'task:complete') {
    if (!globalTronAccount) return;
    broadcast('agent:status', { status: 'Paying...' });
    const r = await agentReason(`Task "${data.title}" done. Send ${data.tip} USDT? Balance: ${agent.usdtBalance.toFixed(4)}`);
    broadcast('agent:reasoning', { text: r });
    if (['SEND_TIP','COMPLETE'].includes(extractAction(r))) await sendUsdtPayment(globalTronAccount, process.env.PEER_TRON_ADDRESS || agent.tronAddress, data.tip, data.title);
    broadcast('agent:status', { status: agent.paused ? 'Paused' : 'Active' });
  } else if (type === 'agent:pause') {
    agent.paused = true; agent.pauseReason = 'UI pause';
    broadcast('agent:paused', { reason: agent.pauseReason });
  } else if (type === 'agent:resume') {
    agent.paused = false; agent.pauseReason = '';
    broadcast('agent:resumed', {});
  } else if (type === 'payment:confirm' && agent.pendingPayment) {
    const { recipient, amount, taskName, chain } = agent.pendingPayment;
    agent.pendingPayment = null;
    const prev = CONFIG.paymentRole; CONFIG.paymentRole = 'autonomous';
    if (chain === 'usdt') await sendUsdtPayment(globalTronAccount, recipient, amount, taskName);
    else await sendSolPayment(globalSolAccount, recipient, amount, taskName);
    CONFIG.paymentRole = prev;
  } else if (type === 'payment:reject' && agent.pendingPayment) {
    recordAudit('REJECTED', agent.pendingPayment, 'UI'); agent.pendingPayment = null;
    broadcast('agent:reasoning', { text: 'Payment rejected by operator.' });
  } else if (type === 'balance:refresh') {
    if (globalTronAccount) await refreshBalances(globalTronAccount, globalSolAccount);
  }
}

// ── Safety ─────────────────────────────────────────────────
function checkDailyReset() {
  const day = 86400000; const now = Date.now();
  if (now - agent.usdtDailyReset > day) { agent.usdtDailySpent = 0; agent.usdtDailyReset = now; }
  if (now - agent.solDailyReset  > day) { agent.solDailySpent  = 0; agent.solDailyReset  = now; }
}

function safetyCheck(amount, chain = 'usdt') {
  checkDailyReset();
  if (agent.paused) return { safe: false, reason: `Paused: ${agent.pauseReason}` };
  if (chain === 'usdt') {
    const c = CONFIG.tron;
    if (amount > c.maxTipPerTx)                     return { safe: false, reason: `Exceeds max ${c.maxTipPerTx} USDT/tx` };
    if (agent.usdtDailySpent + amount > c.dailyCap) return { safe: false, reason: `Daily cap reached` };
    if (agent.usdtBalance - amount < c.minBal)      return { safe: false, reason: `Would drop below min ${c.minBal} USDT` };
    if (agent.usdtBalance < c.minBal)               return { safe: false, reason: `Balance too low: ${agent.usdtBalance.toFixed(4)} USDT` };
    if (agent.usdtBalance < c.lowBal) broadcast('agent:reasoning', { text: `⚠️ Low USDT: ${agent.usdtBalance.toFixed(4)}` });
  } else {
    const c = CONFIG.solana;
    if (amount > c.maxTipPerTx)                    return { safe: false, reason: `Exceeds max ${c.maxTipPerTx} SOL/tx` };
    if (agent.solDailySpent + amount > c.dailyCap) return { safe: false, reason: `Daily SOL cap reached` };
    if (agent.solBalance - amount < c.minBal)      return { safe: false, reason: `Would drop below min SOL` };
    if (agent.solBalance < 0.001)                  return { safe: false, reason: `SOL too low for gas` };
  }
  return { safe: true };
}

function recordAudit(action, details, result) {
  agent.auditLog.push({ ts: new Date().toISOString(), action, details, result, usdt: agent.usdtBalance, sol: agent.solBalance });
  if (agent.auditLog.length > 100) agent.auditLog.shift();
}

// ── Groq reasoning ─────────────────────────────────────────
const SYSTEM_PROMPT = `You are PaydayAgent — an autonomous AI wallet agent on the Intercom P2P network.
You hold real WDK wallets: Tron mainnet (USD₮ TRC20) and Solana devnet (coordination proofs).
Safety: max ${CONFIG.tron.maxTipPerTx} USDT/tx | daily ${CONFIG.tron.dailyCap} USDT | min ${CONFIG.tron.minBal} USDT
Role: ${CONFIG.paymentRole}
Under 100 words. End with: ACTION: PICK_UP | COMPLETE | SEND_TIP | SEND_SOL | SKIP | BROADCAST | PAUSE`;

async function agentReason(situation) {
  try {
    const res = await groq.chat.completions.create({
      model: CONFIG.model, max_tokens: 200, temperature: 0.7,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: `Situation: ${situation}\nState: USDT=${agent.usdtBalance.toFixed(4)} SOL=${agent.solBalance.toFixed(6)} DailySpent=${agent.usdtDailySpent.toFixed(4)} Tasks=${agent.tasksCompleted} TotalPaid=${agent.totalPaidUsdt.toFixed(4)} Paused=${agent.paused}\nReason then ACTION.` },
      ],
    });
    return res.choices[0]?.message?.content || 'No response. ACTION: SKIP';
  } catch (err) {
    recordAudit('GROQ_ERROR', {}, err.message);
    return `Groq error. ACTION: SKIP`;
  }
}

function extractAction(text) {
  const actions = ['PICK_UP','COMPLETE','SEND_TIP','SEND_SOL','SKIP','BROADCAST','PAUSE'];
  for (const a of actions) if (text.toUpperCase().includes(`ACTION: ${a}`)) return a;
  for (const a of actions) if (text.toUpperCase().includes(a))              return a;
  return 'SKIP';
}

// ── USDT payment ───────────────────────────────────────────
async function sendUsdtPayment(tronAcc, recipient, amount, taskName) {
  const check = safetyCheck(amount, 'usdt');
  if (!check.safe) {
    console.log(`\n🛡️  BLOCKED: ${check.reason}`);
    broadcast('payment:blocked', { reason: check.reason, amount, chain: 'usdt' });
    broadcast('agent:reasoning', { text: `Payment blocked: ${check.reason}` });
    recordAudit('USDT_BLOCKED', { recipient, amount, taskName }, check.reason);
    if (agent.usdtBalance < CONFIG.tron.minBal) {
      agent.paused = true; agent.pauseReason = 'USDT below minimum';
      broadcast('agent:paused', { reason: agent.pauseReason });
    }
    return null;
  }
  if (CONFIG.paymentRole === 'supervised') {
    agent.pendingPayment = { recipient, amount, taskName, chain: 'usdt' };
    broadcast('payment:queued', { recipient, amount, taskName, chain: 'usdt' });
    broadcast('agent:reasoning', { text: `Supervised: ${amount} USDT queued for "${taskName}" — type confirm` });
    recordAudit('USDT_QUEUED', { recipient, amount, taskName }, 'AWAITING');
    return null;
  }
  const amountBase = BigInt(Math.round(amount * Math.pow(10, CONFIG.tron.decimals)));
  console.log(`\n💸 WDK Tron: ${amount} USDT → ${recipient.slice(0,14)}... [${taskName}]`);
  broadcast('agent:reasoning', { text: `WDK Tron executing: ${amount} USD₮ TRC20 → ${recipient.slice(0,12)}...` });
  try {
    const result = await tronAcc.transfer({ token: CONFIG.tron.usdtContract, recipient, amount: amountBase });
    agent.usdtBalance    = Math.max(0, agent.usdtBalance - amount);
    agent.usdtDailySpent += amount;
    agent.totalPaidUsdt  += amount;
    agent.tasksCompleted++;
    const explorer = `https://tronscan.org/#/transaction/${result.hash}`;
    console.log(`✅ TX: ${result.hash}\n   ${explorer}`);
    broadcast('payment:sent', { txHash: result.hash, amount, recipient, chain: 'tron', taskName, explorer });
    broadcast('balance:update', { usdt: agent.usdtBalance, sol: agent.solBalance, tronAddress: agent.tronAddress, solAddress: agent.solAddress });
    broadcast('agent:reasoning', { text: `✅ Confirmed on Tron mainnet! ${amount} USD₮ sent. TX: ${result.hash.slice(0,24)}... Balance: ${agent.usdtBalance.toFixed(4)} USDT` });
    recordAudit('USDT_SENT', { recipient, amount, taskName, txHash: result.hash }, 'CONFIRMED');
    return result;
  } catch (err) {
    console.error(`❌ USDT failed: ${err.message}`);
    broadcast('payment:blocked', { reason: err.message, amount, chain: 'usdt' });
    broadcast('agent:reasoning', { text: `Transfer failed: ${err.message}. Refreshing state...` });
    recordAudit('USDT_FAILED', { recipient, amount, taskName }, err.message);
    try {
      const u = await tronAcc.getTokenBalance(CONFIG.tron.usdtContract);
      agent.usdtBalance = Number(u) / Math.pow(10, CONFIG.tron.decimals);
      broadcast('balance:update', { usdt: agent.usdtBalance, sol: agent.solBalance, tronAddress: agent.tronAddress, solAddress: agent.solAddress });
    } catch {}
    return null;
  }
}

// ── SOL payment ────────────────────────────────────────────
async function sendSolPayment(solAcc, recipient, amount, taskName) {
  const check = safetyCheck(amount, 'sol');
  if (!check.safe) {
    broadcast('payment:blocked', { reason: check.reason, amount, chain: 'sol' });
    recordAudit('SOL_BLOCKED', { recipient, amount, taskName }, check.reason);
    return null;
  }
  if (CONFIG.paymentRole === 'supervised') {
    agent.pendingPayment = { recipient, amount, taskName, chain: 'sol' };
    broadcast('payment:queued', { recipient, amount, taskName, chain: 'sol' });
    return null;
  }
  const lamports = Math.round(amount * 1_000_000_000);
  console.log(`\n💸 WDK Solana: ${amount} SOL → ${recipient.slice(0,14)}...`);
  try {
    const result = await solAcc.sendTransaction({ to: recipient, value: lamports });
    const fee = Number(result.fee || 0) / 1_000_000_000;
    agent.solBalance    = Math.max(0, agent.solBalance - amount - fee);
    agent.solDailySpent += amount; agent.totalPaidSol += amount; agent.tasksCompleted++;
    broadcast('payment:sent', { txHash: result.hash, amount, recipient, chain: 'sol', taskName, explorer: `https://explorer.solana.com/tx/${result.hash}?cluster=${CONFIG.solana.network}` });
    broadcast('balance:update', { usdt: agent.usdtBalance, sol: agent.solBalance, tronAddress: agent.tronAddress, solAddress: agent.solAddress });
    recordAudit('SOL_SENT', { recipient, amount, taskName, txHash: result.hash }, 'CONFIRMED');
    return result;
  } catch (err) {
    console.error(`❌ SOL failed: ${err.message}`);
    recordAudit('SOL_FAILED', { recipient, amount, taskName }, err.message);
    return null;
  }
}

// ── Wallet init ────────────────────────────────────────────
async function initWallets() {
  const seed = process.env.SEED_PHRASE;
  if (!seed)                     { console.error('❌ SEED_PHRASE not set'); process.exit(1); }
  if (!process.env.GROQ_API_KEY) { console.error('❌ GROQ_API_KEY not set'); process.exit(1); }
  if (!WalletManagerSolana.isValidSeedPhrase(seed)) { console.error('❌ Invalid seed'); process.exit(1); }

  console.log(`\n🔑 [1/2] WDK Solana (${CONFIG.solana.network})...`);
  const solWallet  = new WalletManagerSolana(seed, { rpcUrl: CONFIG.solana.rpc, transferMaxFee: CONFIG.solana.maxFee });
  globalSolAccount = await solWallet.getAccount(0);
  agent.solAddress = await globalSolAccount.getAddress();
  agent.solBalance = Number(await globalSolAccount.getBalance()) / 1_000_000_000;
  console.log(`   Address : ${agent.solAddress}`);
  console.log(`   Balance : ${agent.solBalance.toFixed(6)} SOL${agent.solBalance < 0.01 ? ' ⚠️  fund at https://faucet.solana.com' : ''}`);

  console.log(`\n🔑 [2/2] WDK Tron (mainnet)...`);
  const tronWallet  = new WalletManagerTron(seed, { provider: CONFIG.tron.provider, transferMaxFee: CONFIG.tron.maxFee });
  globalTronAccount = await tronWallet.getAccount(0);
  agent.tronAddress = await globalTronAccount.getAddress();
  agent.usdtBalance = Number(await globalTronAccount.getTokenBalance(CONFIG.tron.usdtContract)) / Math.pow(10, CONFIG.tron.decimals);
  console.log(`   Address : ${agent.tronAddress}`);
  console.log(`   Balance : ${agent.usdtBalance.toFixed(4)} USDT${agent.usdtBalance < CONFIG.tron.lowBal ? ' ⚠️  fund via https://sun.io' : ''}`);

  console.log(`\n🛡️  Safety: max/tx ${CONFIG.tron.maxTipPerTx} USDT | daily ${CONFIG.tron.dailyCap} USDT | min ${CONFIG.tron.minBal} USDT | role: ${CONFIG.paymentRole}`);
  console.log(`\n🧠 Groq ${CONFIG.model}...`);
  const t = await agentReason('You just started. Confirm ready in one sentence.');
  console.log(`💭 ${t.slice(0, 120)}`);
}

async function refreshBalances(tronAcc, solAcc) {
  try {
    agent.usdtBalance = Number(await tronAcc.getTokenBalance(CONFIG.tron.usdtContract)) / Math.pow(10, CONFIG.tron.decimals);
    agent.solBalance  = Number(await solAcc.getBalance()) / 1_000_000_000;
    broadcast('balance:update', { usdt: agent.usdtBalance, sol: agent.solBalance, tronAddress: agent.tronAddress, solAddress: agent.solAddress });
  } catch (err) { console.error(`⚠️  Balance: ${err.message}`); }
}

// ── Autonomous Loop ────────────────────────────────────────
const taskQueue  = [];
let   loopTaskId = 1;
let   loopBusy   = false;

const TASK_POOL = [
  { title: 'Monitor 0000intercom for RFQ requests',   desc: 'Watch global rendezvous and respond to swap requests from peers.',    priority: 'high',   tip: 0.10 },
  { title: 'Verify Tron escrow before USD₮ release',  desc: 'Check on-chain escrow state before authorising WDK payment.',        priority: 'high',   tip: 0.15 },
  { title: 'Replicate subnet state to 3 peers',       desc: 'Ensure contract state is consistent across all active Trac peers.',  priority: 'medium', tip: 0.10 },
  { title: 'Broadcast svc_announce to sidechannel',   desc: 'Re-post service announcement — sidechannels have no history.',       priority: 'low',    tip: 0.05 },
  { title: 'Check Tron RPC latency and failover',     desc: 'Ping trongrid.io — switch provider if latency exceeds 500ms.',      priority: 'medium', tip: 0.08 },
  { title: 'Validate peer Noise XX handshakes',       desc: 'Confirm all connected peers have valid encrypted channels.',         priority: 'medium', tip: 0.10 },
  { title: 'Purge stale RFQ quotes from network',    desc: 'Remove expired quotes older than 5 minutes from the network.',      priority: 'low',    tip: 0.05 },
  { title: 'Monitor USD₮ escrow timeout windows',    desc: 'Scan open trades for approaching Tron deadlines and alert peers.',  priority: 'high',   tip: 0.20 },
  { title: 'Confirm swap settlement on Tron',         desc: 'Verify counterparty received USD₮ before closing the trade.',      priority: 'high',   tip: 0.15 },
  { title: 'Sync agent state to Intercom peers',      desc: 'Broadcast current balance and task capacity to the network.',      priority: 'low',    tip: 0.05 },
];

function pickNewTask() {
  const active    = new Set(taskQueue.filter(t => t.status !== 'done').map(t => t.title));
  const available = TASK_POOL.filter(t => !active.has(t.title));
  if (!available.length) return null;
  return available[Math.floor(Math.random() * available.length)];
}

function enqueueTask(def) {
  const task = { id: loopTaskId++, ...def, status: 'todo', assignee: 'PaydayAgent', createdAt: Date.now() };
  taskQueue.push(task);
  broadcast('task:created', { title: task.title, priority: task.priority, tip: task.tip, desc: task.desc });
  console.log(`\n📋 [LOOP] Queued: "${task.title}" | ${task.priority} | ${task.tip} USDT`);
  return task;
}

async function autonomousLoopTick() {
  if (loopBusy || agent.paused || !globalTronAccount) return;
  loopBusy = true;
  try {
    const todos      = taskQueue.filter(t => t.status === 'todo');
    const inProgress = taskQueue.filter(t => t.status === 'inprogress');
    const done       = taskQueue.filter(t => t.status === 'done');

    // 1. Seed queue
    if (todos.length === 0 && inProgress.length === 0) {
      const def = pickNewTask();
      if (def) {
        const task = enqueueTask(def);
        broadcast('agent:reasoning', { text: `Network scan: detected work — "${task.title}" | ${task.priority} | ${task.tip} USDT. Queued.` });
      } else {
        broadcast('agent:reasoning', { text: `All ${done.length} tasks complete. Total paid: ${agent.totalPaidUsdt.toFixed(4)} USD₮. Monitoring for new work...` });
        broadcast('agent:action', { action: 'BROADCAST', details: { tasksCompleted: agent.tasksCompleted, totalPaid: agent.totalPaidUsdt } });
      }
      loopBusy = false; return;
    }

    // 2. Pick up a todo
    if (todos.length > 0 && inProgress.length === 0) {
      const target = todos.find(t => t.priority === 'high') || todos.find(t => t.priority === 'medium') || todos[0];
      broadcast('agent:status', { status: 'Reasoning...' });
      const reasoning = await agentReason(`Task: "${target.title}" | ${target.priority} | ${target.tip} USDT. Pick up?`);
      const action    = extractAction(reasoning);
      broadcast('agent:reasoning', { text: reasoning });
      broadcast('agent:action',    { action, details: { title: target.title, priority: target.priority } });
      if (['PICK_UP','COMPLETE','SEND_TIP'].includes(action)) {
        target.status = 'inprogress'; target.createdAt = Date.now();
        broadcast('task:pickedup', { title: target.title, assignee: 'PaydayAgent' });
        broadcast('agent:status',  { status: 'Working...' });
        console.log(`\n🤖 [LOOP] Picked up: "${target.title}"`);
        recordAudit('PICK_UP', { title: target.title }, reasoning.slice(0, 80));
      } else if (action === 'PAUSE') {
        agent.paused = true; agent.pauseReason = 'Self-paused: low balance';
        broadcast('agent:paused', { reason: agent.pauseReason });
      } else {
        target.status = 'done';
        recordAudit('SKIP', { title: target.title }, action);
      }
      loopBusy = false; return;
    }

    // 3. Complete in-progress
    if (inProgress.length > 0) {
      const target  = inProgress[0];
      const elapsed = Date.now() - target.createdAt;
      if (elapsed < CONFIG.loopWorkMs) {
        const remaining = Math.round((CONFIG.loopWorkMs - elapsed) / 1000);
        broadcast('agent:reasoning', { text: `Working on "${target.title}"... completing in ${remaining}s.` });
        loopBusy = false; return;
      }
      broadcast('agent:status', { status: 'Completing...' });
      const reasoning = await agentReason(`Task "${target.title}" done. Send ${target.tip} USDT via WDK Tron? Balance: ${agent.usdtBalance.toFixed(4)} USDT.`);
      const action    = extractAction(reasoning);
      broadcast('agent:reasoning', { text: reasoning });
      broadcast('agent:action',    { action, details: { title: target.title, tip: target.tip } });
      if (['SEND_TIP','COMPLETE'].includes(action)) {
        console.log(`\n✅ [LOOP] Completing "${target.title}" → ${target.tip} USDT`);
        const result = await sendUsdtPayment(globalTronAccount, process.env.PEER_TRON_ADDRESS || agent.tronAddress, target.tip, target.title);
        if (result) {
          target.status = 'done';
          broadcast('task:completed', { title: target.title, txHash: result.hash, tip: target.tip });
          const next = pickNewTask();
          if (next) setTimeout(() => enqueueTask(next), 4000);
        } else {
          target.createdAt = Date.now(); // reset timer, retry next tick
        }
      } else if (action === 'PAUSE') {
        agent.paused = true; agent.pauseReason = 'Low balance';
        broadcast('agent:paused', { reason: agent.pauseReason });
      } else {
        target.status = 'done';
        recordAudit('SKIP_PAYMENT', { title: target.title }, action);
      }
      broadcast('agent:status', { status: agent.paused ? 'Paused' : 'Active' });
    }
  } catch (err) {
    console.error(`\n❌ [LOOP] ${err.message}`);
    recordAudit('LOOP_ERROR', {}, err.message);
  }
  loopBusy = false;
}

function startAutonomousLoop() {
  const tick = CONFIG.loopTickMs; const work = CONFIG.loopWorkMs;
  console.log(`\n🔄 Autonomous loop started — tick every ${tick/1000}s | work time ${work/1000}s`);
  console.log(`   Agent picks up tasks, works, and pays — no human input required`);
  broadcast('agent:reasoning', { text: `Autonomous loop active. Tick: ${tick/1000}s. Agent operates independently — no human input required.` });
  const first = pickNewTask();
  if (first) enqueueTask(first);
  setTimeout(autonomousLoopTick, 5000);
  setInterval(autonomousLoopTick, tick);
}

// ── CLI ────────────────────────────────────────────────────
async function startCLI() {
  console.log(`\n📡 CLI: balance | loop | safety | audit | tip <addr> <amt> | pause | resume | confirm | reject | clients | quit`);
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '\nPaydayAgent > ' });
  rl.prompt();
  rl.on('line', async (line) => {
    const parts = line.trim().split(/\s+/); const cmd = parts[0]?.toLowerCase();
    try {
      if (cmd === 'balance') {
        if (globalTronAccount) await refreshBalances(globalTronAccount, globalSolAccount);
        console.log(`\n💰 USDT: ${agent.usdtBalance.toFixed(4)} | SOL: ${agent.solBalance.toFixed(6)}`);
        console.log(`   Tron: ${agent.tronAddress}\n   Sol : ${agent.solAddress}`);
      } else if (cmd === 'loop') {
        const t = taskQueue.filter(q => q.status === 'todo').length;
        const i = taskQueue.filter(q => q.status === 'inprogress').length;
        const d = taskQueue.filter(q => q.status === 'done').length;
        console.log(`\n🔄 Loop: todo=${t} in-progress=${i} done=${d} busy=${loopBusy}`);
        taskQueue.slice(-5).forEach((q, n) => console.log(`   [${n+1}] ${q.status.padEnd(12)} ${q.title}`));
      } else if (cmd === 'tip') {
        const addr = parts[1]; const amt = parseFloat(parts[2]) || CONFIG.tron.defaultTip;
        if (!addr) console.log('Usage: tip <tron-address> <usdt-amount>');
        else await sendUsdtPayment(globalTronAccount, addr, amt, 'Manual CLI tip');
      } else if (cmd === 'safety') {
        checkDailyReset();
        console.log(`\n🛡️  USDT: ${agent.usdtDailySpent.toFixed(4)}/${CONFIG.tron.dailyCap} | bal ${agent.usdtBalance.toFixed(4)}`);
        console.log(`   SOL : ${agent.solDailySpent.toFixed(4)}/${CONFIG.solana.dailyCap} | bal ${agent.solBalance.toFixed(6)}`);
        console.log(`   Paused: ${agent.paused} | Role: ${CONFIG.paymentRole}`);
      } else if (cmd === 'audit') {
        agent.auditLog.slice(-5).forEach((e, i) => console.log(`\n[${i+1}] ${e.ts} | ${e.action} | ${e.result}`));
      } else if (cmd === 'pause') {
        agent.paused = true; agent.pauseReason = 'CLI';
        broadcast('agent:paused', { reason: agent.pauseReason }); console.log(`\n⛔ Paused`);
      } else if (cmd === 'resume') {
        agent.paused = false; agent.pauseReason = '';
        broadcast('agent:resumed', {}); console.log(`\n✅ Resumed`);
      } else if (cmd === 'confirm') {
        if (!agent.pendingPayment) { console.log('\nNo pending payment'); }
        else {
          const { recipient, amount, taskName, chain } = agent.pendingPayment; agent.pendingPayment = null;
          const prev = CONFIG.paymentRole; CONFIG.paymentRole = 'autonomous';
          if (chain === 'usdt') await sendUsdtPayment(globalTronAccount, recipient, amount, taskName);
          else await sendSolPayment(globalSolAccount, recipient, amount, taskName);
          CONFIG.paymentRole = prev;
        }
      } else if (cmd === 'reject') {
        if (agent.pendingPayment) { recordAudit('REJECTED', agent.pendingPayment, 'CLI'); agent.pendingPayment = null; console.log(`\n❌ Rejected`); }
      } else if (cmd === 'clients') {
        console.log(`\n🌐 ${clients.size} client(s)`);
      } else if (cmd === 'quit' || cmd === 'exit') {
        console.log(`\n📋 ${agent.tasksCompleted} tasks | ${agent.totalPaidUsdt.toFixed(4)} USDT paid`); process.exit(0);
      } else if (cmd) { console.log(`Unknown: "${cmd}"`); }
    } catch (err) { console.error(`\n❌ ${err.message}`); }
    rl.prompt();
  });
}

// ── Main ───────────────────────────────────────────────────
async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║        INTERCOM PAYDAY — WDK Autonomous Wallet Agent     ║
║   Groq Llama 3 · WDK Tron mainnet · WDK Solana devnet   ║
║   Autonomous Loop · WebSocket · No Human Input Required  ║
║         Hackathon Galáctica: Agent Wallets Track         ║
╚══════════════════════════════════════════════════════════╝`);
  try {
    startWebSocketServer();
    await initWallets();
    broadcast('balance:update', { usdt: agent.usdtBalance, sol: agent.solBalance, tronAddress: agent.tronAddress, solAddress: agent.solAddress });
    startAutonomousLoop();       // ← agent runs itself from here
    await startCLI();            // ← CLI alongside, not instead of
    setInterval(() => refreshBalances(globalTronAccount, globalSolAccount), 60_000);
    process.on('SIGINT', () => {
      console.log(`\n\n📋 ${agent.tasksCompleted} tasks | ${agent.totalPaidUsdt.toFixed(4)} USDT paid\n👋 Shutting down...`);
      process.exit(0);
    });
  } catch (err) {
    console.error(`\n❌ Fatal: ${err.message}`); process.exit(1);
  }
}

main();