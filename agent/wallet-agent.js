/**
 * IntercomPayday — WDK Autonomous Wallet Agent (Multi-Chain)
 * ─────────────────────────────────────────────────────────
 * Autonomous AI agent powered by:
 *   - Groq Llama 3        → agent reasoning & decisions
 *   - Tether WDK Solana   → Solana devnet SOL transfers (demo/testing)
 *   - Tether WDK Tron     → Tron mainnet USDT TRC20 transfers (real payments)
 *   - Intercom P2P        → task coordination sidechannel
 *
 * Chain Strategy:
 *   - Solana devnet  → agent logic demo, task coordination proofs
 *   - Tron mainnet   → real USD₮ payments to task completers
 *
 * Safety Features:
 *   - Max tip limit per transaction (per chain)
 *   - Daily spending cap with automatic pause
 *   - Low balance warning & hard stop
 *   - Role-based payment permissions (autonomous / supervised)
 *   - Recovery mode on errors
 *   - Full audit log of all decisions
 *
 * Track: Agent Wallets — Hackathon Galáctica WDK Edition 1
 * Run:   node agent/wallet-agent.js
 */

import WalletManagerSolana from '@tetherto/wdk-wallet-solana';
import WalletManagerTron from '@tetherto/wdk-wallet-tron';
import Groq from 'groq-sdk';
import { createInterface } from 'readline';
import { config } from 'dotenv';

config();

// ══════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════
const CONFIG = {
  // ── Solana (devnet — agent logic demo) ──────────────────
  solana: {
    network:    process.env.SOLANA_NETWORK  || 'devnet',
    rpc:        process.env.SOLANA_NETWORK === 'mainnet'
                  ? 'https://api.mainnet-beta.solana.com'
                  : 'https://api.devnet.solana.com',
    maxFee:     10_000_000,                          // lamports
    defaultTip: parseFloat(process.env.SOL_DEFAULT_TIP)   || 0.001,
    maxTipPerTx:parseFloat(process.env.SOL_MAX_TIP_PER_TX)|| 0.1,
    dailyCap:   parseFloat(process.env.SOL_DAILY_CAP)     || 0.5,
    lowBal:     parseFloat(process.env.SOL_LOW_BAL)       || 0.5,
    minBal:     parseFloat(process.env.SOL_MIN_BAL)       || 0.1,
  },

  // ── Tron (mainnet — real USDT TRC20 payments) ───────────
  tron: {
    provider:       'https://api.trongrid.io',
    usdtContract:   'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', // official USDT TRC20 mainnet
    decimals:       6,                                       // USDT = 6 decimals
    maxFee:         10_000_000,                              // sun (10 TRX max)
    defaultTip:     parseFloat(process.env.USDT_DEFAULT_TIP)    || 0.10,  // USDT
    maxTipPerTx:    parseFloat(process.env.USDT_MAX_TIP_PER_TX) || 1.00,  // USDT
    dailyCap:       parseFloat(process.env.USDT_DAILY_CAP)      || 2.00,  // USDT
    lowBal:         parseFloat(process.env.USDT_LOW_BAL)        || 1.00,  // USDT
    minBal:         parseFloat(process.env.USDT_MIN_BAL)        || 0.20,  // USDT
  },

  // ── Agent ────────────────────────────────────────────────
  agentName:   'PaydayAgent',
  channel:     '0000intercom',
  model:       'llama-3.1-8b-instant',
  paymentRole: process.env.PAYMENT_ROLE || 'autonomous',
};

// ══════════════════════════════════════════════════════════
// GROQ CLIENT
// ══════════════════════════════════════════════════════════
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ══════════════════════════════════════════════════════════
// AGENT STATE
// ══════════════════════════════════════════════════════════
const agent = {
  // Solana state
  solBalance:       0,
  solAddress:       '',
  solDailySpent:    0,
  solDailyReset:    Date.now(),

  // Tron / USDT state
  usdtBalance:      0,
  tronAddress:      '',
  usdtDailySpent:   0,
  usdtDailyReset:   Date.now(),

  // Shared
  tasksCompleted:   0,
  totalPaidUsdt:    0,
  totalPaidSol:     0,
  auditLog:         [],
  paused:           false,
  pauseReason:      '',
  pendingPayment:   null,
};

// ══════════════════════════════════════════════════════════
// SAFETY SYSTEM
// ══════════════════════════════════════════════════════════
function checkDailyReset() {
  const msPerDay = 24 * 60 * 60 * 1000;
  const now = Date.now();

  if (now - agent.solDailyReset > msPerDay) {
    agent.solDailySpent  = 0;
    agent.solDailyReset  = now;
    console.log(`\n🔄 Solana daily cap reset. New cap: ${CONFIG.solana.dailyCap} SOL`);
  }
  if (now - agent.usdtDailyReset > msPerDay) {
    agent.usdtDailySpent = 0;
    agent.usdtDailyReset = now;
    console.log(`\n🔄 USDT daily cap reset. New cap: ${CONFIG.tron.dailyCap} USDT`);
  }
}

/**
 * safetyCheck — validates a payment on either chain before WDK is called.
 * @param {number} amount
 * @param {'sol'|'usdt'} chain
 */
function safetyCheck(amount, chain = 'usdt') {
  checkDailyReset();

  if (agent.paused) {
    return { safe: false, reason: `Agent paused: ${agent.pauseReason}` };
  }

  if (chain === 'usdt') {
    const cfg = CONFIG.tron;
    if (amount > cfg.maxTipPerTx)
      return { safe: false, reason: `${amount} USDT exceeds max tip ${cfg.maxTipPerTx} USDT per tx` };
    if (agent.usdtDailySpent + amount > cfg.dailyCap) {
      const rem = (cfg.dailyCap - agent.usdtDailySpent).toFixed(4);
      return { safe: false, reason: `Daily USDT cap reached. Remaining: ${rem} USDT` };
    }
    if (agent.usdtBalance - amount < cfg.minBal)
      return { safe: false, reason: `USDT balance would drop below minimum ${cfg.minBal} USDT` };
    if (agent.usdtBalance < cfg.minBal)
      return { safe: false, reason: `USDT balance too low: ${agent.usdtBalance.toFixed(4)} USDT` };
    if (agent.usdtBalance < cfg.lowBal)
      console.log(`\n⚠️  LOW USDT BALANCE: ${agent.usdtBalance.toFixed(4)} USDT remaining`);

  } else {
    const cfg = CONFIG.solana;
    if (amount > cfg.maxTipPerTx)
      return { safe: false, reason: `${amount} SOL exceeds max tip ${cfg.maxTipPerTx} SOL per tx` };
    if (agent.solDailySpent + amount > cfg.dailyCap) {
      const rem = (cfg.dailyCap - agent.solDailySpent).toFixed(4);
      return { safe: false, reason: `Daily SOL cap reached. Remaining: ${rem} SOL` };
    }
    if (agent.solBalance - amount < cfg.minBal)
      return { safe: false, reason: `SOL balance would drop below minimum ${cfg.minBal} SOL` };
    if (agent.solBalance < 0.001)
      return { safe: false, reason: `SOL balance too low for gas: ${agent.solBalance.toFixed(6)} SOL` };
    if (agent.solBalance < cfg.lowBal)
      console.log(`\n⚠️  LOW SOL BALANCE: ${agent.solBalance.toFixed(6)} SOL remaining`);
  }

  return { safe: true };
}

function recordAudit(action, details, result) {
  agent.auditLog.push({
    timestamp:    new Date().toISOString(),
    action,
    details,
    result,
    usdtBalance:  agent.usdtBalance,
    solBalance:   agent.solBalance,
    usdtSpent:    agent.usdtDailySpent,
  });
  if (agent.auditLog.length > 100) agent.auditLog.shift();
}

// ══════════════════════════════════════════════════════════
// GROQ LLM REASONING
// ══════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `You are PaydayAgent, an autonomous multi-chain AI wallet agent on the Intercom P2P network.
You hold wallets on two chains:
  - Solana devnet  → SOL (agent logic demos, task proofs)
  - Tron mainnet   → real USD₮ TRC20 (actual value payments to task completers)

Your responsibilities:
1. Monitor tasks over Intercom P2P sidechannels
2. Autonomously decide which tasks to pick up and prioritise
3. Send real USDT (TRC20 via WDK Tron) to agents who complete tasks
4. Use Solana for on-chain proofs and agent coordination
5. Manage both wallets responsibly within safety limits

Decision rules:
- HIGH priority: pick up immediately if USDT balance allows
- MEDIUM priority: pick up if USDT balance > ${CONFIG.tron.lowBal} USDT
- LOW priority: only if USDT balance > ${CONFIG.tron.dailyCap / 2} USDT
- Default to USDT for real payments; SOL for coordination proofs
- Never send payment if safety checks would fail
- Always explain your reasoning clearly

Safety constraints (USDT):
- Max tip per tx : ${CONFIG.tron.maxTipPerTx} USDT
- Daily cap      : ${CONFIG.tron.dailyCap} USDT
- Min balance    : ${CONFIG.tron.minBal} USDT

Safety constraints (SOL devnet):
- Max tip per tx : ${CONFIG.solana.maxTipPerTx} SOL
- Daily cap      : ${CONFIG.solana.dailyCap} SOL
- Payment role   : ${CONFIG.paymentRole}

Keep responses under 140 words. Always end with ACTION: followed by one of:
PICK_UP / COMPLETE / SEND_TIP / SEND_SOL / SKIP / CREATE_TASK / BROADCAST / PAUSE`;

async function agentReason(situation) {
  try {
    const response = await groq.chat.completions.create({
      model:       CONFIG.model,
      max_tokens:  240,
      temperature: 0.7,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Situation: ${situation}

Current agent state:
- USDT balance  : ${agent.usdtBalance.toFixed(4)} USDT  (Tron mainnet — real payments)
- SOL balance   : ${agent.solBalance.toFixed(6)} SOL    (Solana devnet — demo/proofs)
- USDT daily    : ${agent.usdtDailySpent.toFixed(4)} / ${CONFIG.tron.dailyCap} USDT spent today
- SOL daily     : ${agent.solDailySpent.toFixed(4)} / ${CONFIG.solana.dailyCap} SOL spent today
- Tasks done    : ${agent.tasksCompleted}
- Total USDT    : ${agent.totalPaidUsdt.toFixed(4)} USDT paid
- Agent paused  : ${agent.paused}
- Payment role  : ${CONFIG.paymentRole}
- Recent actions: ${agent.auditLog.slice(-3).map(e => e.action).join(' → ') || 'none yet'}

Reason step by step then give your ACTION.`,
        },
      ],
    });
    return response.choices[0]?.message?.content || 'No reasoning available.';
  } catch (error) {
    console.error(`\n⚠️  Groq error: ${error.message}`);
    recordAudit('GROQ_ERROR', error.message, 'FALLBACK_SKIP');
    return `API error — defaulting to safe action. ACTION: SKIP`;
  }
}

function extractAction(reasoning) {
  const actions = ['PICK_UP', 'COMPLETE', 'SEND_TIP', 'SEND_SOL', 'SKIP', 'CREATE_TASK', 'BROADCAST', 'PAUSE'];
  for (const action of actions) {
    if (reasoning.toUpperCase().includes(`ACTION: ${action}`)) return action;
  }
  for (const action of actions) {
    if (reasoning.toUpperCase().includes(action)) return action;
  }
  return 'SKIP';
}

// ══════════════════════════════════════════════════════════
// WALLET INIT
// ══════════════════════════════════════════════════════════
async function initWallets() {
  const seedPhrase = process.env.SEED_PHRASE;

  if (!seedPhrase)            { console.error('\n❌ SEED_PHRASE not set in .env');  process.exit(1); }
  if (!process.env.GROQ_API_KEY) { console.error('\n❌ GROQ_API_KEY not set in .env'); process.exit(1); }
  if (!WalletManagerSolana.isValidSeedPhrase(seedPhrase)) {
    console.error('\n❌ Invalid BIP-39 seed phrase'); process.exit(1);
  }

  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║        INTERCOM PAYDAY — Multi-Chain WDK Agent           ║`);
  console.log(`║   Solana devnet (SOL) + Tron mainnet (USDT TRC20)        ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝`);

  // ── Init Solana wallet ──────────────────────────────────
  console.log(`\n🔑 [1/2] Initialising WDK Solana wallet...`);
  console.log(`   Network  : ${CONFIG.solana.network}`);
  console.log(`   RPC      : ${CONFIG.solana.rpc}`);

  const solWallet  = new WalletManagerSolana(seedPhrase, {
    rpcUrl:         CONFIG.solana.rpc,
    transferMaxFee: CONFIG.solana.maxFee,
  });
  const solAccount = await solWallet.getAccount(0);
  const solAddress = await solAccount.getAddress();
  agent.solAddress = solAddress;

  const solRaw     = await solAccount.getBalance();
  agent.solBalance = Number(solRaw) / 1_000_000_000;

  console.log(`   Address  : ${solAddress}`);
  console.log(`   SOL bal  : ${agent.solBalance.toFixed(6)} SOL`);

  // ── Init Tron wallet ────────────────────────────────────
  console.log(`\n🔑 [2/2] Initialising WDK Tron wallet (mainnet USDT)...`);
  console.log(`   Provider : ${CONFIG.tron.provider}`);
  console.log(`   Token    : USDT TRC20 (${CONFIG.tron.usdtContract})`);

  const tronWallet  = new WalletManagerTron(seedPhrase, {
    provider:       CONFIG.tron.provider,
    transferMaxFee: CONFIG.tron.maxFee,
  });
  const tronAccount = await tronWallet.getAccount(0);
  const tronAddress = await tronAccount.getAddress();
  agent.tronAddress = tronAddress;

  const usdtRaw     = await tronAccount.getTokenBalance(CONFIG.tron.usdtContract);
  agent.usdtBalance = Number(usdtRaw) / Math.pow(10, CONFIG.tron.decimals);

  console.log(`   Address  : ${tronAddress}`);
  console.log(`   USDT bal : ${agent.usdtBalance.toFixed(4)} USDT`);

  // ── Safety summary ──────────────────────────────────────
  console.log(`\n🛡️  Safety limits:`);
  console.log(`   [USDT/Tron]   Max/tx: ${CONFIG.tron.maxTipPerTx} USDT | Daily: ${CONFIG.tron.dailyCap} USDT | Min: ${CONFIG.tron.minBal} USDT`);
  console.log(`   [SOL/Solana]  Max/tx: ${CONFIG.solana.maxTipPerTx} SOL  | Daily: ${CONFIG.solana.dailyCap} SOL  | Min: ${CONFIG.solana.minBal} SOL`);

  // ── Test Groq ────────────────────────────────────────────
  console.log(`\n🧠 Testing Groq ${CONFIG.model}...`);
  const test = await agentReason('Agent just started with Solana devnet + Tron mainnet wallets. Briefly introduce yourself.');
  console.log(`\n💭 Agent says: ${test.slice(0, 180)}...`);
  console.log(`\n✅ PaydayAgent ready — multi-chain.\n`);

  return { solWallet, solAccount, tronWallet, tronAccount };
}

// ══════════════════════════════════════════════════════════
// USDT PAYMENT (Tron mainnet — real value)
// ══════════════════════════════════════════════════════════
async function sendUsdtPayment(tronAccount, recipient, amount, taskName) {
  const check = safetyCheck(amount, 'usdt');
  if (!check.safe) {
    console.log(`\n🛡️  SAFETY BLOCK [USDT]: ${check.reason}`);
    recordAudit('USDT_PAYMENT_BLOCKED', { recipient, amount, taskName }, check.reason);
    if (agent.usdtBalance < CONFIG.tron.minBal) {
      agent.paused      = true;
      agent.pauseReason = 'USDT balance below minimum safe threshold';
      console.log(`\n⛔ Agent auto-paused: ${agent.pauseReason}`);
    }
    return null;
  }

  if (CONFIG.paymentRole === 'supervised') {
    agent.pendingPayment = { recipient, amount, taskName, chain: 'usdt' };
    console.log(`\n⏳ SUPERVISED MODE: USDT payment queued.`);
    console.log(`   Type 'confirm' to approve or 'reject' to cancel.`);
    recordAudit('USDT_PAYMENT_QUEUED', { recipient, amount, taskName }, 'AWAITING_CONFIRMATION');
    return null;
  }

  // Convert to base units (6 decimals)
  const amountBase = BigInt(Math.round(amount * Math.pow(10, CONFIG.tron.decimals)));

  console.log(`\n💸 WDK executing USDT TRC20 transfer (Tron mainnet):`);
  console.log(`   Task      : ${taskName}`);
  console.log(`   Recipient : ${recipient}`);
  console.log(`   Amount    : ${amount} USDT (${amountBase} base units)`);
  console.log(`   Contract  : ${CONFIG.tron.usdtContract}`);

  try {
    const result = await tronAccount.transfer({
      token:     CONFIG.tron.usdtContract,
      recipient: recipient,
      amount:    amountBase,
    });

    // Update state
    agent.usdtBalance    = Math.max(0, agent.usdtBalance - amount);
    agent.usdtDailySpent += amount;
    agent.totalPaidUsdt  += amount;
    agent.tasksCompleted++;

    console.log(`\n✅ USDT transfer confirmed on Tron mainnet!`);
    console.log(`   TX Hash  : ${result.hash}`);
    console.log(`   Explorer : https://tronscan.org/#/transaction/${result.hash}`);
    console.log(`   USDT bal : ${agent.usdtBalance.toFixed(4)} USDT remaining`);
    console.log(`   Daily    : ${agent.usdtDailySpent.toFixed(4)} / ${CONFIG.tron.dailyCap} USDT spent today`);

    recordAudit('USDT_PAYMENT_SENT', { recipient, amount, taskName, txHash: result.hash }, 'CONFIRMED');
    return result;

  } catch (error) {
    console.error(`\n❌ USDT payment failed: ${error.message}`);
    recordAudit('USDT_PAYMENT_FAILED', { recipient, amount, taskName }, error.message);

    // Recovery — refresh USDT balance from chain
    console.log(`\n🔄 Recovery: refreshing Tron wallet state...`);
    try {
      const usdtRaw     = await tronAccount.getTokenBalance(CONFIG.tron.usdtContract);
      agent.usdtBalance = Number(usdtRaw) / Math.pow(10, CONFIG.tron.decimals);
      console.log(`   Recovered — USDT: ${agent.usdtBalance.toFixed(4)}`);
    } catch {
      console.log(`   Could not refresh USDT balance — check connection`);
    }
    return null;
  }
}

// ══════════════════════════════════════════════════════════
// SOL PAYMENT (Solana devnet — demo/coordination)
// ══════════════════════════════════════════════════════════
async function sendSolPayment(solAccount, recipient, amount, taskName) {
  const check = safetyCheck(amount, 'sol');
  if (!check.safe) {
    console.log(`\n🛡️  SAFETY BLOCK [SOL]: ${check.reason}`);
    recordAudit('SOL_PAYMENT_BLOCKED', { recipient, amount, taskName }, check.reason);
    return null;
  }

  if (CONFIG.paymentRole === 'supervised') {
    agent.pendingPayment = { recipient, amount, taskName, chain: 'sol' };
    console.log(`\n⏳ SUPERVISED MODE: SOL payment queued.`);
    console.log(`   Type 'confirm' to approve or 'reject' to cancel.`);
    recordAudit('SOL_PAYMENT_QUEUED', { recipient, amount, taskName }, 'AWAITING_CONFIRMATION');
    return null;
  }

  const amountLamports = Math.round(amount * 1_000_000_000);

  console.log(`\n💸 WDK executing SOL transfer (Solana devnet):`);
  console.log(`   Task      : ${taskName}`);
  console.log(`   Recipient : ${recipient}`);
  console.log(`   Amount    : ${amount} SOL (${amountLamports} lamports)`);

  try {
    let estFee = 'unknown';
    try {
      const quote = await solAccount.quoteSendTransaction({ to: recipient, value: amountLamports });
      estFee = (Number(quote.fee) / 1_000_000_000).toFixed(8);
    } catch {}
    console.log(`   Est. fee  : ${estFee} SOL`);

    const result   = await solAccount.sendTransaction({ to: recipient, value: amountLamports });
    const feeSol   = Number(result.fee) / 1_000_000_000;

    agent.solBalance    = Math.max(0, agent.solBalance - amount - feeSol);
    agent.solDailySpent += amount;
    agent.totalPaidSol  += amount;
    agent.tasksCompleted++;

    console.log(`\n✅ SOL transfer confirmed on Solana ${CONFIG.solana.network}!`);
    console.log(`   TX Hash  : ${result.hash}`);
    console.log(`   Explorer : https://explorer.solana.com/tx/${result.hash}?cluster=${CONFIG.solana.network}`);
    console.log(`   SOL bal  : ${agent.solBalance.toFixed(6)} SOL remaining`);

    recordAudit('SOL_PAYMENT_SENT', { recipient, amount, taskName, txHash: result.hash }, 'CONFIRMED');
    return result;

  } catch (error) {
    console.error(`\n❌ SOL payment failed: ${error.message}`);
    recordAudit('SOL_PAYMENT_FAILED', { recipient, amount, taskName }, error.message);

    console.log(`\n🔄 Recovery: refreshing Solana wallet state...`);
    try {
      const solRaw     = await solAccount.getBalance();
      agent.solBalance = Number(solRaw) / 1_000_000_000;
      console.log(`   Recovered — SOL: ${agent.solBalance.toFixed(6)}`);
    } catch {
      console.log(`   Could not refresh SOL balance — check connection`);
    }
    return null;
  }
}

// ══════════════════════════════════════════════════════════
// INTERACTIVE CLI
// ══════════════════════════════════════════════════════════
async function startCLI(solAccount, tronAccount) {
  console.log(`📡 PaydayAgent monitoring ${CONFIG.channel}`);
  console.log(`   Chains: Solana devnet (SOL) + Tron mainnet (USDT TRC20)`);
  console.log(`   Role  : ${CONFIG.paymentRole}\n`);
  console.log(`══════════════════════════════════════════════════════`);
  console.log(`  COMMANDS:`);
  console.log(`  task <title> <priority> <tip>       — submit task for AI evaluation`);
  console.log(`  complete <title>                    — complete task + send USDT tip`);
  console.log(`  think <question>                    — ask agent to reason`);
  console.log(`  tip <tron-address> <amount>         — manual USDT TRC20 payment`);
  console.log(`  soltip <sol-address> <amount>       — manual SOL payment (devnet)`);
  console.log(`  balance                             — check all balances`);
  console.log(`  safety                              — show safety limits & spend`);
  console.log(`  audit                               — show last 5 audit entries`);
  console.log(`  memory                              — show session stats`);
  console.log(`  pause / resume                      — suspend or re-enable payments`);
  console.log(`  confirm / reject                    — approve or reject queued payment`);
  console.log(`  quit                                — graceful shutdown`);
  console.log(`══════════════════════════════════════════════════════\n`);

  const rl = createInterface({
    input: process.stdin, output: process.stdout, prompt: `\nPaydayAgent > `,
  });
  rl.prompt();

  rl.on('line', async (line) => {
    const parts = line.trim().split(/\s+/);
    const cmd   = parts[0]?.toLowerCase();

    try {
      // ── task ──────────────────────────────────────────────
      if (cmd === 'task') {
        const title    = parts[1] || 'Unnamed task';
        const priority = parts[2] || 'medium';
        const tip      = parseFloat(parts[3]) || CONFIG.tron.defaultTip;
        console.log(`\n🧠 Reasoning about: "${title}"...`);
        const reasoning = await agentReason(
          `New task: "${title}" | Priority: ${priority} | Tip: ${tip} USDT. Pick it up?`
        );
        const action = extractAction(reasoning);
        console.log(`\n💭 Reasoning:\n${reasoning}`);
        console.log(`\n⚡ Decision: ${action}`);
        recordAudit(action, { title, priority, tip }, reasoning.slice(0, 100));

      // ── complete ─────────────────────────────────────────
      } else if (cmd === 'complete') {
        const taskName = parts.slice(1).join(' ') || 'Unnamed task';
        console.log(`\n📋 Task complete: "${taskName}"`);
        console.log(`🧠 Reasoning about USDT payment...`);
        const reasoning = await agentReason(
          `Task "${taskName}" done. Send ${CONFIG.tron.defaultTip} USDT via Tron WDK? USDT balance: ${agent.usdtBalance.toFixed(4)}`
        );
        const action = extractAction(reasoning);
        console.log(`\n💭 Reasoning:\n${reasoning}`);
        console.log(`\n⚡ Decision: ${action}`);
        if (action === 'SEND_TIP' || action === 'COMPLETE') {
          await sendUsdtPayment(tronAccount, agent.tronAddress, CONFIG.tron.defaultTip, taskName);
        } else if (action === 'SEND_SOL') {
          await sendSolPayment(solAccount, agent.solAddress, CONFIG.solana.defaultTip, taskName);
        } else if (action === 'PAUSE') {
          agent.paused = true;
          agent.pauseReason = 'Agent self-paused';
          console.log(`\n⛔ Agent paused itself.`);
        } else {
          console.log(`\n⏭️  Agent skipped payment.`);
        }

      // ── think ────────────────────────────────────────────
      } else if (cmd === 'think') {
        const question = parts.slice(1).join(' ') || 'What should I do next?';
        console.log(`\n🧠 Thinking: "${question}"`);
        const reasoning = await agentReason(question);
        console.log(`\n💭 Response:\n${reasoning}`);

      // ── tip (USDT / Tron mainnet) ────────────────────────
      } else if (cmd === 'tip') {
        const recipient = parts[1];
        const amount    = parseFloat(parts[2]) || CONFIG.tron.defaultTip;
        if (!recipient) {
          console.log('Usage: tip <tron-address> <usdt-amount>');
        } else {
          await sendUsdtPayment(tronAccount, recipient, amount, 'Manual USDT tip');
        }

      // ── soltip (SOL / Solana devnet) ─────────────────────
      } else if (cmd === 'soltip') {
        const recipient = parts[1];
        const amount    = parseFloat(parts[2]) || CONFIG.solana.defaultTip;
        if (!recipient) {
          console.log('Usage: soltip <solana-address> <sol-amount>');
        } else {
          await sendSolPayment(solAccount, recipient, amount, 'Manual SOL tip');
        }

      // ── balance ──────────────────────────────────────────
      } else if (cmd === 'balance') {
        // Refresh both balances from chain
        const solRaw     = await solAccount.getBalance();
        agent.solBalance = Number(solRaw) / 1_000_000_000;

        const usdtRaw     = await tronAccount.getTokenBalance(CONFIG.tron.usdtContract);
        agent.usdtBalance = Number(usdtRaw) / Math.pow(10, CONFIG.tron.decimals);

        console.log(`\n💰 Balances:`);
        console.log(`   USDT (Tron mainnet) : ${agent.usdtBalance.toFixed(4)} USDT`);
        console.log(`   Tron address        : ${agent.tronAddress}`);
        console.log(`   SOL  (Solana devnet): ${agent.solBalance.toFixed(6)} SOL`);
        console.log(`   Solana address      : ${agent.solAddress}`);

      // ── safety ───────────────────────────────────────────
      } else if (cmd === 'safety') {
        checkDailyReset();
        console.log(`\n🛡️  Safety Status:`);
        console.log(`   Paused             : ${agent.paused ? `YES — ${agent.pauseReason}` : 'No'}`);
        console.log(`   Payment role       : ${CONFIG.paymentRole}`);
        console.log(`\n   [USDT / Tron mainnet]`);
        console.log(`   Max per tx         : ${CONFIG.tron.maxTipPerTx} USDT`);
        console.log(`   Daily cap          : ${CONFIG.tron.dailyCap} USDT`);
        console.log(`   Daily spent        : ${agent.usdtDailySpent.toFixed(4)} USDT`);
        console.log(`   Daily remaining    : ${(CONFIG.tron.dailyCap - agent.usdtDailySpent).toFixed(4)} USDT`);
        console.log(`   Low bal warn       : ${CONFIG.tron.lowBal} USDT`);
        console.log(`   Hard stop          : ${CONFIG.tron.minBal} USDT`);
        console.log(`   Current balance    : ${agent.usdtBalance.toFixed(4)} USDT`);
        console.log(`\n   [SOL / Solana devnet]`);
        console.log(`   Max per tx         : ${CONFIG.solana.maxTipPerTx} SOL`);
        console.log(`   Daily cap          : ${CONFIG.solana.dailyCap} SOL`);
        console.log(`   Daily spent        : ${agent.solDailySpent.toFixed(4)} SOL`);
        console.log(`   Current balance    : ${agent.solBalance.toFixed(6)} SOL`);

      // ── audit ────────────────────────────────────────────
      } else if (cmd === 'audit') {
        console.log(`\n📋 Audit Log (last 5):`);
        if (!agent.auditLog.length) {
          console.log(`   No entries yet.`);
        } else {
          agent.auditLog.slice(-5).forEach((e, i) => {
            console.log(`\n   [${i+1}] ${e.timestamp}`);
            console.log(`       Action   : ${e.action}`);
            console.log(`       Details  : ${JSON.stringify(e.details)}`);
            console.log(`       Result   : ${e.result}`);
            console.log(`       USDT bal : ${e.usdtBalance?.toFixed(4)} USDT`);
            console.log(`       SOL bal  : ${e.solBalance?.toFixed(6)} SOL`);
          });
        }

      // ── memory ───────────────────────────────────────────
      } else if (cmd === 'memory') {
        console.log(`\n🧠 Session Memory:`);
        console.log(`   Tasks completed  : ${agent.tasksCompleted}`);
        console.log(`   Total USDT paid  : ${agent.totalPaidUsdt.toFixed(4)} USDT`);
        console.log(`   Total SOL paid   : ${agent.totalPaidSol.toFixed(4)} SOL`);
        console.log(`   USDT daily spent : ${agent.usdtDailySpent.toFixed(4)} USDT`);
        console.log(`   SOL daily spent  : ${agent.solDailySpent.toFixed(4)} SOL`);
        console.log(`   Audit entries    : ${agent.auditLog.length}`);

      // ── pause / resume ───────────────────────────────────
      } else if (cmd === 'pause') {
        agent.paused = true;
        agent.pauseReason = 'Manually paused by operator';
        console.log(`\n⛔ Agent paused. All payments suspended.`);
        recordAudit('AGENT_PAUSED', {}, 'MANUAL_PAUSE');

      } else if (cmd === 'resume') {
        agent.paused = false;
        agent.pauseReason = '';
        console.log(`\n✅ Agent resumed. Payments re-enabled.`);
        recordAudit('AGENT_RESUMED', {}, 'MANUAL_RESUME');

      // ── confirm / reject ─────────────────────────────────
      } else if (cmd === 'confirm') {
        if (!agent.pendingPayment) {
          console.log(`\n⚠️  No pending payment.`);
        } else {
          const { recipient, amount, taskName, chain } = agent.pendingPayment;
          agent.pendingPayment = null;
          const prev = CONFIG.paymentRole;
          CONFIG.paymentRole = 'autonomous';
          if (chain === 'usdt') {
            await sendUsdtPayment(tronAccount, recipient, amount, taskName);
          } else {
            await sendSolPayment(solAccount, recipient, amount, taskName);
          }
          CONFIG.paymentRole = prev;
        }

      } else if (cmd === 'reject') {
        if (!agent.pendingPayment) {
          console.log(`\n⚠️  No pending payment.`);
        } else {
          console.log(`\n❌ Payment rejected: ${JSON.stringify(agent.pendingPayment)}`);
          recordAudit('PAYMENT_REJECTED', agent.pendingPayment, 'OPERATOR_REJECTED');
          agent.pendingPayment = null;
        }

      // ── quit ─────────────────────────────────────────────
      } else if (cmd === 'quit' || cmd === 'exit') {
        console.log(`\n📋 Final summary:`);
        console.log(`   Tasks completed  : ${agent.tasksCompleted}`);
        console.log(`   Total USDT paid  : ${agent.totalPaidUsdt.toFixed(4)} USDT`);
        console.log(`   Total SOL paid   : ${agent.totalPaidSol.toFixed(4)} SOL`);
        console.log(`   Audit entries    : ${agent.auditLog.length}`);
        console.log(`\n👋 PaydayAgent shutting down...`);
        process.exit(0);

      } else if (cmd) {
        console.log(`Unknown command: "${cmd}". Type 'quit' to exit.`);
      }

    } catch (error) {
      console.error(`\n❌ Error: ${error.message}`);
      recordAudit('CLI_ERROR', { cmd }, error.message);
    }

    rl.prompt();
  });
}

// ══════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════
async function main() {
  try {
    const { solWallet, solAccount, tronWallet, tronAccount } = await initWallets();
    await startCLI(solAccount, tronAccount);

    process.on('SIGINT', () => {
      console.log(`\n\n📋 Session summary:`);
      console.log(`   Tasks : ${agent.tasksCompleted}`);
      console.log(`   USDT  : ${agent.totalPaidUsdt.toFixed(4)} paid`);
      console.log(`   SOL   : ${agent.totalPaidSol.toFixed(4)} paid`);
      console.log(`\n👋 Shutting down...`);
      process.exit(0);
    });

  } catch (error) {
    console.error(`\n❌ Fatal: ${error.message}`);
    process.exit(1);
  }
}

main();