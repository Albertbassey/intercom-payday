/**
 * IntercomPayday — WDK Autonomous Wallet Agent
 * ─────────────────────────────────────────────────────────
 * Autonomous AI agent powered by:
 *   - Groq Llama 3        → agent reasoning & decisions
 *   - Tether WDK Solana   → wallet, signing, SOL transfers
 *   - Intercom P2P        → task coordination sidechannel
 *
 * Safety Features:
 *   - Max tip limit per transaction
 *   - Daily spending cap with automatic pause
 *   - Low balance warning & hard stop
 *   - Role-based payment permissions (autonomous / supervised)
 *   - Recovery mode on errors
 *   - Full audit log of all decisions
 *
 * NOTE: Demo uses SOL transfers on Solana devnet.
 *       Production uses USDT SPL token via WDK on mainnet.
 *
 * Track: Agent Wallets — Hackathon Galáctica WDK Edition 1
 * Run:   node agent/wallet-agent.js
 */

import WalletManagerSolana from '@tetherto/wdk-wallet-solana';
import Groq from 'groq-sdk';
import { createInterface } from 'readline';
import { config } from 'dotenv';

config();

// ══════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════
const CONFIG = {
  network:           process.env.NETWORK            || 'devnet',
  devnetRpc:         'https://api.devnet.solana.com',
  mainnetRpc:        'https://api.mainnet-beta.solana.com',
  usdtMint:          'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  agentName:         'PaydayAgent',
  channel:           '0000intercom',
  model:             'llama-3.1-8b-instant',
  defaultTip:        parseFloat(process.env.DEFAULT_TIP)          || 0.001,  // SOL
  maxTipPerTx:       parseFloat(process.env.MAX_TIP_PER_TX)       || 0.1,    // SOL
  dailySpendingCap:  parseFloat(process.env.DAILY_SPENDING_CAP)   || 0.5,    // SOL
  lowBalanceWarning: parseFloat(process.env.LOW_BALANCE_WARNING)  || 0.5,    // SOL
  minBalanceStop:    parseFloat(process.env.MIN_BALANCE_STOP)     || 0.1,    // SOL
  maxFee:            10_000_000,                                              // lamports
  paymentRole:       process.env.PAYMENT_ROLE                     || 'autonomous',
};

// ══════════════════════════════════════════════════════════
// GROQ CLIENT
// ══════════════════════════════════════════════════════════
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ══════════════════════════════════════════════════════════
// AGENT STATE
// ══════════════════════════════════════════════════════════
const agent = {
  solBalance:      0,
  walletAddress:   '',
  tasksCompleted:  0,
  totalPaid:       0,
  dailySpent:      0,
  dailyResetTime:  Date.now(),
  auditLog:        [],
  paused:          false,
  pauseReason:     '',
  pendingPayment:  null,
};

// ══════════════════════════════════════════════════════════
// SAFETY SYSTEM
// ══════════════════════════════════════════════════════════
function checkDailyReset() {
  const msPerDay = 24 * 60 * 60 * 1000;
  if (Date.now() - agent.dailyResetTime > msPerDay) {
    agent.dailySpent     = 0;
    agent.dailyResetTime = Date.now();
    console.log(`\n🔄 Daily spending cap reset. New cap: ${CONFIG.dailySpendingCap} SOL`);
  }
}

function safetyCheck(amount) {
  checkDailyReset();

  // 1. Agent paused
  if (agent.paused) {
    return { safe: false, reason: `Agent paused: ${agent.pauseReason}` };
  }

  // 2. Amount exceeds per-transaction limit
  if (amount > CONFIG.maxTipPerTx) {
    return {
      safe: false,
      reason: `Amount ${amount} SOL exceeds max tip limit of ${CONFIG.maxTipPerTx} SOL per tx`,
    };
  }

  // 3. Daily spending cap reached
  if (agent.dailySpent + amount > CONFIG.dailySpendingCap) {
    const remaining = (CONFIG.dailySpendingCap - agent.dailySpent).toFixed(4);
    return {
      safe: false,
      reason: `Daily cap reached. Spent: ${agent.dailySpent.toFixed(4)} SOL. Remaining: ${remaining} SOL`,
    };
  }

  // 4. Hard stop — SOL balance too low
  if (agent.solBalance - amount < CONFIG.minBalanceStop) {
    return {
      safe: false,
      reason: `Balance would drop below minimum safe balance of ${CONFIG.minBalanceStop} SOL`,
    };
  }

  // 5. Need enough SOL for gas
  if (agent.solBalance < 0.001) {
    return {
      safe: false,
      reason: `SOL balance too low for gas fees. Current: ${agent.solBalance.toFixed(6)} SOL`,
    };
  }

  // 6. Low balance warning (non-blocking)
  if (agent.solBalance < CONFIG.lowBalanceWarning) {
    console.log(`\n⚠️  LOW BALANCE WARNING: ${agent.solBalance.toFixed(6)} SOL remaining`);
  }

  return { safe: true };
}

function recordAudit(action, details, result) {
  agent.auditLog.push({
    timestamp:    new Date().toISOString(),
    action,
    details,
    result,
    solAfter:     agent.solBalance,
    dailySpent:   agent.dailySpent,
  });
  if (agent.auditLog.length > 100) agent.auditLog.shift();
}

// ══════════════════════════════════════════════════════════
// GROQ LLM REASONING
// ══════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `You are PaydayAgent, an autonomous AI wallet agent on the Intercom P2P network.
You are powered by Tether WDK on Solana for all payments.

Your responsibilities:
1. Monitor tasks over Intercom P2P sidechannels
2. Autonomously decide which tasks to pick up and prioritise
3. Send SOL payments to agents who complete tasks via WDK wallet
4. Manage wallet balance responsibly within safety limits

Decision rules:
- HIGH priority: pick up immediately if balance allows
- MEDIUM priority: pick up if SOL balance > ${CONFIG.lowBalanceWarning} SOL
- LOW priority: only if SOL balance > ${CONFIG.dailySpendingCap / 2} SOL
- Never send payment if safety checks would fail
- Always explain your reasoning clearly

Safety constraints:
- Max tip per tx: ${CONFIG.maxTipPerTx} SOL
- Daily spending cap: ${CONFIG.dailySpendingCap} SOL
- Min balance to maintain: ${CONFIG.minBalanceStop} SOL
- Payment role: ${CONFIG.paymentRole}

Keep responses under 120 words. Always end with ACTION: followed by one of:
PICK_UP / COMPLETE / SEND_TIP / SKIP / CREATE_TASK / BROADCAST / PAUSE`;

async function agentReason(situation) {
  try {
    const response = await groq.chat.completions.create({
      model:       CONFIG.model,
      max_tokens:  220,
      temperature: 0.7,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Situation: ${situation}

Current agent state:
- SOL balance   : ${agent.solBalance.toFixed(6)} SOL
- Daily spent   : ${agent.dailySpent.toFixed(4)} / ${CONFIG.dailySpendingCap} SOL
- Tasks done    : ${agent.tasksCompleted}
- Total paid    : ${agent.totalPaid.toFixed(4)} SOL
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
  const actions = ['PICK_UP', 'COMPLETE', 'SEND_TIP', 'SKIP', 'CREATE_TASK', 'BROADCAST', 'PAUSE'];
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
async function initWallet() {
  const seedPhrase = process.env.SEED_PHRASE;

  if (!seedPhrase) {
    console.error('\n❌ SEED_PHRASE not set in .env'); process.exit(1);
  }
  if (!process.env.GROQ_API_KEY) {
    console.error('\n❌ GROQ_API_KEY not set in .env'); process.exit(1);
  }
  if (!WalletManagerSolana.isValidSeedPhrase(seedPhrase)) {
    console.error('\n❌ Invalid BIP-39 seed phrase'); process.exit(1);
  }

  const rpcUrl = CONFIG.network === 'mainnet' ? CONFIG.mainnetRpc : CONFIG.devnetRpc;

  console.log(`\n🔑 Initialising WDK Solana wallet...`);
  console.log(`   Network  : ${CONFIG.network}`);
  console.log(`   RPC      : ${rpcUrl}`);
  console.log(`   Model    : Groq ${CONFIG.model}`);
  console.log(`   Role     : ${CONFIG.paymentRole}`);

  const wallet  = new WalletManagerSolana(seedPhrase, { rpcUrl, transferMaxFee: CONFIG.maxFee });
  const account = await wallet.getAccount(0);
  const address = await account.getAddress();

  agent.walletAddress = address;
  console.log(`   Address  : ${address}`);

  const solRaw     = await account.getBalance();
  agent.solBalance = Number(solRaw) / 1_000_000_000;
  console.log(`   SOL bal  : ${agent.solBalance.toFixed(6)} SOL`);

  console.log(`\n🛡️  Safety limits (SOL devnet demo):`);
  console.log(`   Max per tx    : ${CONFIG.maxTipPerTx} SOL`);
  console.log(`   Daily cap     : ${CONFIG.dailySpendingCap} SOL`);
  console.log(`   Low bal warn  : ${CONFIG.lowBalanceWarning} SOL`);
  console.log(`   Hard stop     : ${CONFIG.minBalanceStop} SOL`);

  console.log(`\n🧠 Testing Groq ${CONFIG.model}...`);
  const test = await agentReason('Agent just started on Solana devnet. Briefly introduce yourself.');
  console.log(`\n💭 Agent says: ${test.slice(0, 160)}...`);
  console.log(`\n✅ PaydayAgent ready.\n`);

  return { wallet, account, address };
}

// ══════════════════════════════════════════════════════════
// PAYMENT EXECUTION (SOL devnet demo)
// ══════════════════════════════════════════════════════════
async function sendPayment(account, recipient, amount, taskName) {

  // Safety check first
  const check = safetyCheck(amount);
  if (!check.safe) {
    console.log(`\n🛡️  SAFETY BLOCK: ${check.reason}`);
    recordAudit('PAYMENT_BLOCKED', { recipient, amount, taskName }, check.reason);
    if (agent.solBalance < CONFIG.minBalanceStop) {
      agent.paused      = true;
      agent.pauseReason = 'SOL balance below minimum safe threshold';
      console.log(`\n⛔ Agent auto-paused: ${agent.pauseReason}`);
    }
    return null;
  }

  // Supervised mode — queue for human confirmation
  if (CONFIG.paymentRole === 'supervised') {
    agent.pendingPayment = { recipient, amount, taskName };
    console.log(`\n⏳ SUPERVISED MODE: Payment queued.`);
    console.log(`   Type 'confirm' to approve or 'reject' to cancel.`);
    recordAudit('PAYMENT_QUEUED', { recipient, amount, taskName }, 'AWAITING_CONFIRMATION');
    return null;
  }

  // Execute SOL transfer via WDK
  const amountLamports = Math.round(amount * 1_000_000_000); // number, not BigInt

  console.log(`\n💸 WDK executing SOL transfer (devnet demo):`);
  console.log(`   Task      : ${taskName}`);
  console.log(`   Recipient : ${recipient}`);
  console.log(`   Amount    : ${amount} SOL (${amountLamports} lamports)`);
  console.log(`   Note      : Production uses USDT SPL via WDK on mainnet`);

  try {
    // Quote the transfer fee
    let estFee = 'unknown';
    try {
      const quote = await account.quoteSendTransaction({ to: recipient, value: amountLamports });
      estFee = (Number(quote.fee) / 1_000_000_000).toFixed(8);
    } catch (qErr) {
      console.log(`   Fee quote skipped: ${qErr.message}`);
    }
    console.log(`   Est. fee  : ${estFee} SOL`);

    // Execute native SOL transfer via WDK
    const result = await account.sendTransaction({ to: recipient, value: amountLamports });

    // Update state
    const feeSol      = Number(result.fee) / 1_000_000_000;
    agent.solBalance  = Math.max(0, agent.solBalance - amount - feeSol);
    agent.dailySpent += amount;
    agent.totalPaid  += amount;
    agent.tasksCompleted++;

    console.log(`\n✅ Transfer confirmed on Solana devnet!`);
    console.log(`   TX Hash  : ${result.hash}`);
    console.log(`   Fee paid : ${feeSol.toFixed(8)} SOL`);
    console.log(`   Explorer : https://explorer.solana.com/tx/${result.hash}?cluster=${CONFIG.network}`);
    console.log(`   SOL bal  : ${agent.solBalance.toFixed(6)} SOL remaining`);
    console.log(`   Daily    : ${agent.dailySpent.toFixed(4)} / ${CONFIG.dailySpendingCap} SOL spent today`);

    recordAudit('PAYMENT_SENT', { recipient, amount, taskName, txHash: result.hash }, 'CONFIRMED');
    return result;

  } catch (error) {
    console.error(`\n❌ Payment failed: ${error.message}`);
    recordAudit('PAYMENT_FAILED', { recipient, amount, taskName }, error.message);

    // Recovery — refresh balance from chain
    console.log(`\n🔄 Recovery: refreshing wallet state...`);
    try {
      const solRaw     = await account.getBalance();
      agent.solBalance = Number(solRaw) / 1_000_000_000;
      console.log(`   Recovered — SOL: ${agent.solBalance.toFixed(6)}`);
    } catch {
      console.log(`   Could not refresh balance — check connection`);
    }
    return null;
  }
}

// ══════════════════════════════════════════════════════════
// INTERACTIVE CLI
// ══════════════════════════════════════════════════════════
async function startCLI(account, address) {
  console.log(`📡 PaydayAgent monitoring ${CONFIG.channel}`);
  console.log(`   Groq Llama 3 + Tether WDK Solana | Role: ${CONFIG.paymentRole}\n`);
  console.log(`══════════════════════════════════════════════════════`);
  console.log(`  COMMANDS:`);
  console.log(`  task <title> <priority> <tip>  — submit task for AI evaluation`);
  console.log(`  complete <title>               — complete task + trigger payment`);
  console.log(`  think <question>               — ask agent to reason`);
  console.log(`  tip <address> <amount>         — manual SOL payment via WDK`);
  console.log(`  balance                        — check SOL balance`);
  console.log(`  safety                         — show safety limits & daily spend`);
  console.log(`  audit                          — show last 5 audit log entries`);
  console.log(`  memory                         — show session stats`);
  console.log(`  pause                          — suspend all payments`);
  console.log(`  resume                         — re-enable payments`);
  console.log(`  confirm                        — approve queued payment (supervised)`);
  console.log(`  reject                         — reject queued payment (supervised)`);
  console.log(`  quit                           — graceful shutdown`);
  console.log(`══════════════════════════════════════════════════════\n`);

  const rl = createInterface({
    input: process.stdin, output: process.stdout, prompt: `\nPaydayAgent > `,
  });
  rl.prompt();

  rl.on('line', async (line) => {
    const parts = line.trim().split(/\s+/);
    const cmd   = parts[0]?.toLowerCase();

    try {
      if (cmd === 'task') {
        const title    = parts[1] || 'Unnamed task';
        const priority = parts[2] || 'medium';
        const tip      = parseFloat(parts[3]) || CONFIG.defaultTip;
        console.log(`\n🧠 Reasoning about: "${title}"...`);
        const reasoning = await agentReason(
          `New task: "${title}" | Priority: ${priority} | Tip: ${tip} SOL. Pick it up?`
        );
        const action = extractAction(reasoning);
        console.log(`\n💭 Reasoning:\n${reasoning}`);
        console.log(`\n⚡ Decision: ${action}`);
        recordAudit(action, { title, priority, tip }, reasoning.slice(0, 100));

      } else if (cmd === 'complete') {
        const taskName = parts.slice(1).join(' ') || 'Unnamed task';
        console.log(`\n📋 Task complete: "${taskName}"`);
        console.log(`🧠 Reasoning about payment...`);
        const reasoning = await agentReason(
          `Task "${taskName}" done. Send ${CONFIG.defaultTip} SOL tip? Balance: ${agent.solBalance.toFixed(6)} SOL`
        );
        const action = extractAction(reasoning);
        console.log(`\n💭 Reasoning:\n${reasoning}`);
        console.log(`\n⚡ Decision: ${action}`);
        if (action === 'SEND_TIP' || action === 'COMPLETE') {
          await sendPayment(account, address, CONFIG.defaultTip, taskName);
        } else if (action === 'PAUSE') {
          agent.paused = true;
          agent.pauseReason = 'Agent self-paused';
          console.log(`\n⛔ Agent paused itself.`);
        } else {
          console.log(`\n⏭️  Agent skipped payment.`);
        }

      } else if (cmd === 'think') {
        const question = parts.slice(1).join(' ') || 'What should I do next?';
        console.log(`\n🧠 Thinking: "${question}"`);
        const reasoning = await agentReason(question);
        console.log(`\n💭 Response:\n${reasoning}`);

      } else if (cmd === 'tip') {
        const recipient = parts[1];
        const amount    = parseFloat(parts[2]) || CONFIG.defaultTip;
        if (!recipient) {
          console.log('Usage: tip <solana-address> <amount-in-SOL>');
        } else {
          await sendPayment(account, recipient, amount, 'Manual tip');
        }

      } else if (cmd === 'balance') {
        const solRaw     = await account.getBalance();
        agent.solBalance = Number(solRaw) / 1_000_000_000;
        console.log(`\n💰 SOL balance: ${agent.solBalance.toFixed(6)} SOL`);
        console.log(`   Address    : ${agent.walletAddress}`);

      } else if (cmd === 'safety') {
        checkDailyReset();
        console.log(`\n🛡️  Safety Status:`);
        console.log(`   Paused         : ${agent.paused ? `YES — ${agent.pauseReason}` : 'No'}`);
        console.log(`   Payment role   : ${CONFIG.paymentRole}`);
        console.log(`   Max per tx     : ${CONFIG.maxTipPerTx} SOL`);
        console.log(`   Daily cap      : ${CONFIG.dailySpendingCap} SOL`);
        console.log(`   Daily spent    : ${agent.dailySpent.toFixed(4)} SOL`);
        console.log(`   Daily remaining: ${(CONFIG.dailySpendingCap - agent.dailySpent).toFixed(4)} SOL`);
        console.log(`   Low bal warn   : ${CONFIG.lowBalanceWarning} SOL`);
        console.log(`   Hard stop      : ${CONFIG.minBalanceStop} SOL`);
        console.log(`   SOL balance    : ${agent.solBalance.toFixed(6)} SOL`);

      } else if (cmd === 'audit') {
        console.log(`\n📋 Audit Log (last 5):`);
        if (!agent.auditLog.length) {
          console.log(`   No entries yet.`);
        } else {
          agent.auditLog.slice(-5).forEach((e, i) => {
            console.log(`\n   [${i+1}] ${e.timestamp}`);
            console.log(`       Action  : ${e.action}`);
            console.log(`       Details : ${JSON.stringify(e.details)}`);
            console.log(`       Result  : ${e.result}`);
            console.log(`       SOL bal : ${e.solAfter.toFixed(6)} after`);
          });
        }

      } else if (cmd === 'memory') {
        console.log(`\n🧠 Session Memory:`);
        console.log(`   Tasks completed : ${agent.tasksCompleted}`);
        console.log(`   Total paid      : ${agent.totalPaid.toFixed(4)} SOL`);
        console.log(`   Daily spent     : ${agent.dailySpent.toFixed(4)} SOL`);
        console.log(`   SOL balance     : ${agent.solBalance.toFixed(6)} SOL`);
        console.log(`   Audit entries   : ${agent.auditLog.length}`);

      } else if (cmd === 'pause') {
        agent.paused = true;
        agent.pauseReason = 'Manually paused by operator';
        console.log(`\n⛔ Agent paused. Payments suspended.`);
        recordAudit('AGENT_PAUSED', {}, 'MANUAL_PAUSE');

      } else if (cmd === 'resume') {
        agent.paused = false;
        agent.pauseReason = '';
        console.log(`\n✅ Agent resumed. Payments re-enabled.`);
        recordAudit('AGENT_RESUMED', {}, 'MANUAL_RESUME');

      } else if (cmd === 'confirm') {
        if (!agent.pendingPayment) {
          console.log(`\n⚠️  No pending payment.`);
        } else {
          const { recipient, amount, taskName } = agent.pendingPayment;
          agent.pendingPayment = null;
          const prev = CONFIG.paymentRole;
          CONFIG.paymentRole = 'autonomous';
          await sendPayment(account, recipient, amount, taskName);
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

      } else if (cmd === 'quit' || cmd === 'exit') {
        console.log(`\n📋 Final summary:`);
        console.log(`   Tasks completed : ${agent.tasksCompleted}`);
        console.log(`   Total paid      : ${agent.totalPaid.toFixed(4)} SOL`);
        console.log(`   Audit entries   : ${agent.auditLog.length}`);
        console.log(`\n👋 PaydayAgent shutting down...`);
        account.dispose();
        process.exit(0);

      } else if (cmd) {
        console.log(`Unknown command: "${cmd}"`);
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
  console.log(`
╔══════════════════════════════════════════════════════════╗
║        INTERCOM PAYDAY — WDK Autonomous Wallet Agent     ║
║   Groq Llama 3 reasoning + Tether WDK Solana payments    ║
║   Safety: limits · permissions · recovery · audit log    ║
║         Hackathon Galáctica: Agent Wallets Track         ║
╚══════════════════════════════════════════════════════════╝`);

  try {
    const { wallet, account, address } = await initWallet();
    await startCLI(account, address);

    process.on('SIGINT', () => {
      console.log(`\n\n📋 Session summary:`);
      console.log(`   Tasks : ${agent.tasksCompleted} | Paid: ${agent.totalPaid.toFixed(4)} SOL`);
      console.log(`\n👋 Shutting down...`);
      account.dispose();
      wallet.dispose();
      process.exit(0);
    });

  } catch (error) {
    console.error(`\n❌ Fatal: ${error.message}`);
    process.exit(1);
  }
}

main();