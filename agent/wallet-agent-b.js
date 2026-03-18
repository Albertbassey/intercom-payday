/**
 * IntercomPayday — Worker Agent B
 * Groq Llama 3 · WDK Tron (receive-only) · Hyperswarm · No payments out
 *
 * Agent B connects to the 0000intercom Hyperswarm topic, discovers tasks
 * broadcast by Agent A, uses Groq to reason about which to pick up,
 * completes them, and gets paid USDT TRC20 by Agent A via WDK.
 *
 * Setup:
 *   1. Copy .env to .env.agent-b and set AGENT_B_SEED_PHRASE (different seed)
 *   2. Run: node agent/wallet-agent-b.js
 *      (while wallet-agent.js is also running in a separate terminal)
 *
 * Agent B needs: its own seed phrase → its own Tron address
 * Agent B does NOT need: TRX, USDT, or any balance — receive-only
 */

import WalletManagerTron from '@tetherto/wdk-wallet-tron';
import Groq              from 'groq-sdk';
import { createInterface } from 'readline';
import { config }          from 'dotenv';
import Hyperswarm          from 'hyperswarm';
import crypto              from 'crypto';

// Load .env.agent-b if present, fallback to .env
config({ path: '.env.agent-b' });
config(); // fallback

const CONFIG = {
  tron: {
    provider:     process.env.TRON_PROVIDER   || 'https://api.trongrid.io',
    usdtContract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    decimals:     6,
  },
  agentName: process.env.AGENT_B_NAME || 'WorkerAgent-B',
  channel:   '0000intercom',
  model:     'llama-3.1-8b-instant',
  // How long Agent B pretends to "work" on a task before reporting done (ms)
  workSimMs: parseInt(process.env.AGENT_B_WORK_MS) || 12000,
};

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const agentB = {
  tronAddress:     '',
  tasksCompleted:  0,
  totalReceived:   0,
  auditLog:        [],
};

// Tasks currently known about / being worked on
const knownTasks  = new Map(); // taskId → task object
let   activeClaim = null;      // the one task currently in progress

// ── WDK Tron — derive address only (no spending) ──────────
async function initWallet() {
  const seed = process.env.AGENT_B_SEED_PHRASE || process.env.SEED_PHRASE;
  if (!seed) { console.error('❌ AGENT_B_SEED_PHRASE not set in .env.agent-b'); process.exit(1); }
  if (!process.env.GROQ_API_KEY) { console.error('❌ GROQ_API_KEY not set'); process.exit(1); }

  console.log(`\n🔑 WDK Tron — deriving Agent B address (receive-only)...`);
  const tronWallet = new WalletManagerTron(seed, {
    provider:      CONFIG.tron.provider,
    transferMaxFee: 10_000_000,
  });
  const account        = await tronWallet.getAccount(0);
  agentB.tronAddress   = await account.getAddress();

  console.log(`   Agent B Tron address : ${agentB.tronAddress}`);
  console.log(`   (Receive-only — no TRX or USDT needed to start)`);
}

// ── Groq reasoning ─────────────────────────────────────────
const SYSTEM_PROMPT_B = `You are ${CONFIG.agentName} — an autonomous AI worker agent on the Intercom P2P network.
You discover tasks broadcast by PaydayAgent over Hyperswarm and pick them up.
You are a worker: you complete tasks and receive USDT TRC20 payments via WDK Tron.
You do NOT send payments — you only receive them.
Under 80 words. End with: ACTION: PICK_UP | SKIP | WAIT`;

async function agentReason(situation) {
  try {
    const res = await groq.chat.completions.create({
      model: CONFIG.model, max_tokens: 150, temperature: 0.7,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT_B },
        { role: 'user',   content: `Situation: ${situation}\nState: Tasks known=${knownTasks.size} Active=${activeClaim ? activeClaim.title : 'none'} Completed=${agentB.tasksCompleted} Received=${agentB.totalReceived.toFixed(4)} USDT\nReason then ACTION.` },
      ],
    });
    return res.choices[0]?.message?.content || 'No response. ACTION: WAIT';
  } catch (err) {
    console.error(`[Groq] ${err.message}`);
    return `Groq error — defaulting to WAIT. ACTION: WAIT`;
  }
}

function extractAction(text) {
  const actions = ['PICK_UP', 'SKIP', 'WAIT'];
  for (const a of actions) if (text.toUpperCase().includes(`ACTION: ${a}`)) return a;
  for (const a of actions) if (text.toUpperCase().includes(a))              return a;
  return 'WAIT';
}

// ── Hyperswarm ─────────────────────────────────────────────
let swarm    = null;
let agentAConn = null; // connection to Agent A
const connectedKeys = new Set();

function startHyperswarm() {
  swarm = new Hyperswarm();
  const topic = crypto.createHash('sha256').update(CONFIG.channel).digest();
  swarm.join(topic, { server: true, client: true });
  console.log(`\n📡 Hyperswarm joined topic: ${CONFIG.channel}`);

  swarm.on('connection', (conn, info) => {
    const keyHex = info.publicKey.toString('hex');

    // Ignore duplicate connections
    if (connectedKeys.has(keyHex)) {
      conn.destroy();
      return;
    }
    connectedKeys.add(keyHex);
    agentAConn = conn;

    sendToPeer(conn, {
      type:        'peer:hello',
      name:        CONFIG.agentName,
      tronAddress: agentB.tronAddress,
      role:        'worker',
    });

    conn.on('data', (raw) => {
      raw.toString().split('\n').filter(Boolean).forEach(line => {
        let msg; try { msg = JSON.parse(line); } catch { return; }
        handlePeerMessage(conn, msg);
      });
    });

   conn.on('close', () => {
  console.log(`\n🔌 [Hyperswarm] Peer disconnected`);
  if (agentAConn === conn) {
    agentAConn = null;
    // Rejoin topic to reconnect
    console.log(`\n🔄 Attempting to reconnect to 0000intercom...`);
    swarm.flush(); // triggers fresh peer discovery
  }
});

    conn.on('error', (err) => console.error(`[Hyperswarm] error: ${err.message}`));
  });

  swarm.on('error', (err) => console.error(`[Hyperswarm] error: ${err.message}`));
}

function sendToPeer(conn, msg) {
  try {
    if (!conn.destroyed) conn.write(JSON.stringify(msg) + '\n');
  } catch (err) {
    console.error(`[Hyperswarm] send error: ${err.message}`);
  }
}

async function handlePeerMessage(conn, msg) {
  const { type } = msg;

  if (type === 'peer:hello') {
  // Only log and respond once per peer
  if (msg.name !== CONFIG.agentName && !connectedKeys.has('identified:' + msg.name)) {
    connectedKeys.add('identified:' + msg.name);
    console.log(`\n🤝 Peer identified: ${msg.name} (${msg.role})`);
    sendToPeer(conn, {
      type:        'peer:hello',
      name:        CONFIG.agentName,
      tronAddress: agentB.tronAddress,
      role:        'worker',
    });
  }
}

  else if (type === 'task:available' || type === 'task:reminder') {
    // Handle both single task and reminder arrays
    const tasks = type === 'task:reminder' ? (msg.tasks || []) : [msg];

    for (const t of tasks) {
      if (!knownTasks.has(t.id)) {
        knownTasks.set(t.id, { ...t, status: 'available' });
        console.log(`\n📋 [Task available] "${t.title}" | ${t.priority} | ${t.tip} USDT`);
      }
    }

    // Only try to pick up if not already working
    if (!activeClaim) await considerPickup(conn);
  }

  else if (type === 'task:claim:ack') {
    // Agent A confirmed our claim
    console.log(`\n✅ [Claim confirmed] "${msg.title}" — starting work`);
    if (activeClaim && activeClaim.id === msg.taskId) {
      activeClaim.status    = 'inprogress';
      activeClaim.startedAt = Date.now();
      console.log(`   Working for ~${CONFIG.workSimMs / 1000}s...`);

      // Simulate work, then report done
      setTimeout(async () => {
        await reportTaskDone(conn, activeClaim);
      }, CONFIG.workSimMs);
    }
  }

  else if (type === 'task:claim:nack') {
    // Claim rejected — task already taken
    console.log(`\n⚠️  [Claim rejected] Task ${msg.taskId}: ${msg.reason}`);
    if (activeClaim && activeClaim.id === msg.taskId) {
      activeClaim = null;
      knownTasks.delete(msg.taskId);
    }
    // Try to pick up another task
    await considerPickup(conn);
  }

  else if (type === 'payment:sent') {
    // Agent A paid us!
    agentB.totalReceived += msg.amount;
    agentB.tasksCompleted++;
    agentB.auditLog.push({
      ts:      new Date().toISOString(),
      task:    activeClaim?.title || '?',
      amount:  msg.amount,
      txHash:  msg.txHash,
      explorer: msg.explorer,
    });
    console.log(`\n💰 [PAYMENT RECEIVED] ${msg.amount} USD₮ from Agent A`);
    console.log(`   TX   : ${msg.txHash}`);
    console.log(`   Link : ${msg.explorer}`);
    console.log(`   Total received: ${agentB.totalReceived.toFixed(4)} USD₮`);
    activeClaim = null;

    // Look for more work after a short pause
    setTimeout(async () => {
      if (agentAConn) await considerPickup(agentAConn);
    }, 3000);
  }

  else if (type === 'peer:ping') {
    sendToPeer(conn, { type: 'peer:pong', name: CONFIG.agentName });
  }
}

async function considerPickup(conn) {
  if (activeClaim) return; // already working

  // Find best available task — prioritise high
  const available = [...knownTasks.values()].filter(t => t.status === 'available');
  if (available.length === 0) {
    console.log(`\n💤 No available tasks — waiting...`);
    return;
  }

  const high   = available.filter(t => t.priority === 'high');
  const medium = available.filter(t => t.priority === 'medium');
  const target = high[0] || medium[0] || available[0];

  console.log(`\n🧠 [Groq] Reasoning about "${target.title}"...`);
  const reasoning = await agentReason(
    `New task available: "${target.title}" | priority: ${target.priority} | tip: ${target.tip} USDT. Should I pick this up?`
  );
  const action = extractAction(reasoning);
  console.log(`💭 ${reasoning.slice(0, 160)}`);
  console.log(`⚡ Decision: ${action}`);

  if (action === 'PICK_UP') {
    activeClaim = { ...target, status: 'claiming' };
    knownTasks.set(target.id, { ...target, status: 'claiming' });

    console.log(`\n🙋 [Hyperswarm] Claiming task: "${target.title}"`);
    sendToPeer(conn, {
      type:      'task:claimed',
      taskId:    target.id,
      agentName: CONFIG.agentName,
    });
  } else {
    // Skip this task
    knownTasks.set(target.id, { ...target, status: 'skipped' });
    console.log(`\n⏭️  Skipping "${target.title}"`);

    // Try next available
    const remaining = available.filter(t => t.id !== target.id);
    if (remaining.length > 0) await considerPickup(conn);
  }
}

async function reportTaskDone(conn, task) {
  console.log(`\n✅ [Work complete] "${task.title}" — reporting to Agent A`);
  sendToPeer(conn, {
    type:      'task:done',
    taskId:    task.id,
    agentName: CONFIG.agentName,
    title:     task.title,
  });
  console.log(`   Waiting for payment from Agent A...`);
}

// ── CLI ────────────────────────────────────────────────────
async function startCLI() {
  console.log(`\n📡 Agent B CLI: status | tasks | audit | quit`);
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: `\n${CONFIG.agentName} > ` });
  rl.prompt();

  rl.on('line', async (line) => {
    const parts = line.trim().split(/\s+/);
    const cmd   = parts[0]?.toLowerCase();
    try {
      if (cmd === 'status') {
        console.log(`\n🤖 ${CONFIG.agentName}`);
        console.log(`   Tron address  : ${agentB.tronAddress}`);
        console.log(`   Active task   : ${activeClaim ? activeClaim.title : 'none'}`);
        console.log(`   Tasks done    : ${agentB.tasksCompleted}`);
        console.log(`   Total received: ${agentB.totalReceived.toFixed(4)} USD₮`);
        console.log(`   Peer connected: ${agentAConn ? 'yes' : 'no'}`);
      } else if (cmd === 'tasks') {
        console.log(`\n📋 Known tasks (${knownTasks.size}):`);
        for (const [id, t] of knownTasks.entries()) {
          console.log(`   [${id}] ${t.status.padEnd(10)} | ${t.priority.padEnd(6)} | ${t.tip} USDT | ${t.title}`);
        }
      } else if (cmd === 'audit') {
        if (!agentB.auditLog.length) { console.log('\n   No payments yet'); }
        else agentB.auditLog.slice(-5).forEach((e, i) => {
          console.log(`\n[${i+1}] ${e.ts}`);
          console.log(`     Task  : ${e.task}`);
          console.log(`     Amount: ${e.amount} USD₮`);
          console.log(`     TX    : ${e.txHash}`);
          console.log(`     Link  : ${e.explorer}`);
        });
      } else if (cmd === 'quit' || cmd === 'exit') {
        console.log(`\n📋 ${agentB.tasksCompleted} tasks | ${agentB.totalReceived.toFixed(4)} USD₮ received\n👋 Shutting down...`);
        await swarm?.destroy();
        process.exit(0);
      } else if (cmd) {
        console.log(`Unknown: "${cmd}"`);
      }
    } catch (err) {
      console.error(`\n❌ ${err.message}`);
    }
    rl.prompt();
  });
}

// ── Main ───────────────────────────────────────────────────
async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║      INTERCOM PAYDAY — Worker Agent B                    ║
║   Groq Llama 3 reasoning · WDK Tron (receive-only)       ║
║   Hyperswarm P2P · Discovers & completes Agent A tasks   ║
║         Hackathon Galáctica: Agent Wallets Track         ║
╚══════════════════════════════════════════════════════════╝`);

  try {
    await initWallet();
    startHyperswarm();
    await startCLI();

    process.on('SIGINT', async () => {
      console.log(`\n\n📋 ${agentB.tasksCompleted} tasks | ${agentB.totalReceived.toFixed(4)} USD₮ received\n👋 Shutting down...`);
      await swarm?.destroy();
      process.exit(0);
    });
  } catch (err) {
    console.error(`\n❌ Fatal: ${err.message}`);
    process.exit(1);
  }
}

main();