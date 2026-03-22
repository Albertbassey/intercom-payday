# IntercomPayday 💸

Autonomous multi-agent P2P wallet network — two AI agents coordinate over Hyperswarm, complete tasks, and settle real **USD₮ TRC20** payments via Tether WDK on Tron mainnet. Every decision, payment, and peer connection streams live to a browser UI.

**Hackathon Galáctica: WDK Edition 1 — Agent Wallets Track**
**by [Albertbassey](https://github.com/Albertbassey)**

---

## What It Does

Two autonomous AI agents run on separate processes with separate wallets. They find each other over **Hyperswarm P2P**, negotiate tasks, and settle real on-chain payments — no human input required at any stage.

```
Agent A (PaydayAgent)                    Agent B (WorkerAgent-B)
─────────────────────                    ───────────────────────
Creates task from TASK_POOL         ←──  Joins 0000intercom topic
Broadcasts task over Hyperswarm     ──►  Discovers task
Waits for claim                     ←──  Groq reasons: PICK_UP
Confirms claim                      ──►  Works for ~12s
Waits for completion signal         ←──  Reports task:done
Groq reasons: SEND_TIP
Safety check passes
WDK Tron signs + sends USD₮         ──►  Receives real USDT TRC20
TX confirmed on Tron mainnet             on own Tron wallet address
WebSocket → browser UI updates live
Queues next task → loop continues
```

**Everything above happens automatically. No CLI commands needed.**

---

## Track Requirements

| Requirement | Status | Implementation |
|---|---|---|
| Agent framework for reasoning | ✅ | Groq Llama 3 8B on every decision |
| WDK primitives directly | ✅ | `getAccount()` · `transfer()` · `getBalance()` · `getTokenBalance()` |
| Agent holds and sends USD₮ autonomously | ✅ | Real USDT TRC20 transfers on Tron mainnet |
| Clear separation: agent logic vs wallet | ✅ | Groq decides → safety validates → WDK executes |
| Safety: permissions, limits, recovery | ✅ | Per-chain limits, daily caps, auto-pause, audit log |
| Open-source LLM | ✅ | Groq Llama 3 8B (bonus criterion) |
| Composability with other agents | ✅ | Real P2P via Hyperswarm — Agent B is a second independent process |
| Fully autonomous — no human input | ✅ | Loop runs indefinitely, self-queuing |

---

## Architecture

### Two Agents, Two Wallets, One Seed Per Agent

```
Agent A seed phrase  ──► BIP-44 HD ──► Tron mainnet address  (holds USDT + TRX for gas)
                                   ──► Solana devnet address  (coordination proofs)

Agent B seed phrase  ──► BIP-44 HD ──► Tron mainnet address  (receive-only — no balance needed)
```

### System Diagram

```
┌─────────────────────────────────┐
│   BROWSER UI (index.html)       │  Live task board · real Groq text
│   app.js — WebSocket client     │  Real tx hashes · live peer list
└───────────────┬─────────────────┘
                │ ws://localhost:8080
                ▼
┌─────────────────────────────────┐         ┌─────────────────────────┐
│   Agent A — wallet-agent.js     │◄────────►│  Agent B                │
│   Groq Llama 3 reasoning        │ Hyperswarm│  wallet-agent-b.js      │
│   WDK Tron + Solana wallets     │ P2P       │  Groq Llama 3 reasoning │
│   WebSocket server :8080        │ 0000inter │  WDK Tron (receive)     │
│   Safety system + audit log     │ com topic │  No spending required   │
│   Autonomous loop               │           └─────────────────────────┘
└─────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│   Tether WDK — Tron mainnet     │  Real USD₮ TRC20 transfers
│   Tether WDK — Solana devnet    │  Agent coordination proofs
└─────────────────────────────────┘
```

### Hyperswarm P2P Protocol

Both agents join the same deterministic topic derived from `sha256("0000intercom")`.

| Message | Direction | Meaning |
|---|---|---|
| `peer:hello` | Both ways | Identity handshake — name + Tron address |
| `task:available` | A → B | New task broadcast with title, priority, tip |
| `task:claimed` | B → A | Agent B claims a task |
| `task:claim:ack` | A → B | Claim confirmed — start working |
| `task:claim:nack` | A → B | Already taken — try another |
| `task:done` | B → A | Work complete — trigger payment |
| `payment:sent` | A → B | Real tx hash + Tronscan link |

### WebSocket Event Protocol (Agent ↔ UI)

**Agent A → UI:**

| Event | Description |
|---|---|
| `balance:update` | Live USD₮ + SOL balances and wallet addresses |
| `agent:reasoning` | Real Groq output streamed to reasoning box |
| `agent:status` | Working / Completing / Paused etc. |
| `agent:action` | Decision: PICK_UP / SEND_TIP / BROADCAST etc. |
| `payment:sent` | Real on-chain tx confirmed — hash + explorer link |
| `payment:blocked` | Safety system blocked payment + reason |
| `task:created` | New task from autonomous loop |
| `task:pickedup` | Task claimed by Agent A or Agent B |
| `task:completed` | Task done and paid |
| `peer:joined` | Agent B connected over Hyperswarm |
| `peer:left` | Agent B disconnected |

**UI → Agent A:**

| Command | Description |
|---|---|
| `task:create` | Submit task — Agent A reasons about it |
| `task:complete` | Trigger real WDK payment |
| `task:start` | Move to in-progress |
| `agent:pause / resume` | Suspend/re-enable payments |
| `payment:confirm / reject` | Supervised mode approval |
| `balance:refresh` | Force refresh from chain |

---

## Safety System

Every payment goes through `safetyCheck(amount, chain)` before WDK is called.

### Limits (configurable via `.env`)

| Limit | USD₮ (Tron mainnet) | SOL (Solana devnet) |
|---|---|---|
| Max per transaction | 1.00 USD₮ | 0.10 SOL |
| Daily spending cap | 2.00 USD₮ | 0.50 SOL |
| Low balance warning | 1.00 USD₮ | 0.50 SOL |
| Hard stop (auto-pause) | 0.20 USD₮ | 0.10 SOL |

### Payment Roles

- **`autonomous`** — agent sends payments based on Groq reasoning alone
- **`supervised`** — every payment queued; operator confirms or rejects via CLI or UI

### Recovery

- WDK transfer failures trigger automatic balance refresh from chain
- Auto-pause when balance drops below minimum — broadcasts to UI
- All errors caught and logged — agent never crashes
- Audit log: last 100 decisions with timestamps, actions, results, and post-action balances

---

## Tech Stack

| Layer | Technology |
|---|---|
| AI Reasoning | Groq Llama 3 8B |
| Payments — real USD₮ | `@tetherto/wdk-wallet-tron` |
| Coordination proofs | `@tetherto/wdk-wallet-solana` |
| P2P discovery | `hyperswarm` |
| Real-time UI bridge | `ws` (WebSocket) |
| Key derivation | BIP-39 + BIP-44 HD (one seed → two chains) |
| Runtime | Node.js 18+ (ESM) |

---

## Project Structure

```
intercom-payday/
├── agent/
│   ├── wallet-agent.js        # Agent A — payer, WebSocket server, Hyperswarm host
│   └── wallet-agent-b.js      # Agent B — worker, Hyperswarm client, receive-only
├── ui/
│   └── intercom-payday/
│       ├── index.html         # App shell
│       ├── style.css          # Industrial-futurist UI
│       └── app.js             # WebSocket client — live task board, peers, tx feed
├── .env.example               # Agent A config template
├── .env.agent-b               # Agent B config template
├── package.json
└── README.md
```

---

## Setup & Run

### Prerequisites

- Node.js 18+
- A Groq API key — [console.groq.com](https://console.groq.com)
- Two BIP-39 seed phrases (one per agent)
- Agent A's Tron wallet needs **USDT TRC20** and **TRX** for gas

---

### 1. Clone & Install

```bash
git clone https://github.com/Albertbassey/intercom-payday.git
cd intercom-payday
npm install
```

---

### 2. Configure Agent A

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Required
SEED_PHRASE=your twelve words here
GROQ_API_KEY=gsk_...

# Agent A pays this address when tasks complete
# Set to Agent B's Tron address (printed on Agent B startup)
PEER_TRON_ADDRESS=T...

# Optional — defaults shown
TRON_PROVIDER=https://api.trongrid.io
SOLANA_NETWORK=devnet
PAYMENT_ROLE=autonomous
WS_PORT=8080
LOOP_TICK_MS=30000
LOOP_WORK_MS=15000
USDT_DEFAULT_TIP=0.10
USDT_DAILY_CAP=2.00
```

---

### 3. Configure Agent B

Create `.env.agent-b` in the project root:

```env
# Must be a DIFFERENT seed phrase from Agent A
AGENT_B_SEED_PHRASE=different twelve words here
GROQ_API_KEY=gsk_...

AGENT_B_NAME=WorkerAgent-B
AGENT_B_WORK_MS=12000
TRON_PROVIDER=https://api.trongrid.io
```

> Agent B derives a Tron address from its seed phrase. It needs **no TRX and no USDT** — it only receives.

---

### 4. Fund Agent A

Agent A needs two things:

| What | Why | How |
|---|---|---|
| **USDT TRC20** | To pay Agent B per completed task | Send from Trust Wallet or any TRC20 wallet |
| **TRX** | Gas for every USDT transfer on Tron | ~50 TRX is enough for a full demo |

> Get Agent A's Tron address by running `node agent/wallet-agent.js` — it prints on startup.

For Solana devnet SOL (coordination proofs): [faucet.solana.com](https://faucet.solana.com)

---

### 5. Get Agent B's Tron Address

```bash
node agent/wallet-agent-b.js
```

Copy the `Agent B Tron address` printed on startup. Paste it into Agent A's `.env` as `PEER_TRON_ADDRESS`, then restart Agent A.

---

### 6. Run Both Agents

Open two terminals:

```bash
# Terminal 1 — Agent A (payer + task broadcaster)
node agent/wallet-agent.js

# Terminal 2 — Agent B (worker + receiver)
node agent/wallet-agent-b.js
```

You should see:
```
# Agent A terminal
🌐 WebSocket → ws://localhost:8080
🔗 [Hyperswarm] New peer connected
🤝 [Hyperswarm] Peer registered: WorkerAgent-B | Tron: T...

# Agent B terminal
🤝 Peer identified: PaydayAgent (payer)
📋 [Task available] "Monitor 0000intercom for RFQ requests" | high | 0.10 USDT
💭 [Groq] ...reasoning...
⚡ Decision: PICK_UP
✅ [Work complete] "Monitor 0000intercom for RFQ requests" — reporting to Agent A
💰 [PAYMENT RECEIVED] 0.10 USD₮ from Agent A
   TX   : abc123...
   Link : https://tronscan.org/#/transaction/abc123...
```

---

### 7. Open the UI

Open `ui/intercom-payday/index.html` in your browser.

- The WS dot turns **green** when connected to Agent A
- Agent B appears as a live **P2P** peer in the Peers panel
- Real Groq reasoning streams into the reasoning box
- Tasks move across the kanban automatically
- Real Tron tx hashes appear in the Transactions panel with Tronscan links

---

## Agent A CLI Commands

```
balance          — refresh + show USD₮ and SOL balances from chain
loop             — show autonomous task queue (todo / in-progress / done)
peers            — list connected Hyperswarm peers and their Tron addresses
safety           — dual-chain safety limits and daily spend
audit            — last 5 audit log entries
clients          — number of connected UI clients
tip <addr> <amt> — manual USD₮ TRC20 payment via WDK
pause            — suspend all payments (broadcasts to UI)
resume           — re-enable payments (broadcasts to UI)
confirm          — approve queued payment (supervised mode)
reject           — reject queued payment (supervised mode)
quit             — graceful shutdown with session summary
```

## Agent B CLI Commands

```
status    — show Tron address, active task, total received
tasks     — list all known tasks and their status
audit     — last 5 payment receipts with tx hashes
quit      — graceful shutdown
```

---

## WDK Integration

```javascript
import WalletManagerTron   from '@tetherto/wdk-wallet-tron'
import WalletManagerSolana from '@tetherto/wdk-wallet-solana'

// One BIP-39 seed phrase → two WDK wallet instances
const tronWallet = new WalletManagerTron(seedPhrase, { provider, transferMaxFee })
const solWallet  = new WalletManagerSolana(seedPhrase, { rpcUrl, transferMaxFee })

const tronAccount = await tronWallet.getAccount(0)
const tronAddress = await tronAccount.getAddress()
const usdtBalance = await tronAccount.getTokenBalance(USDT_CONTRACT)

// Real USD₮ TRC20 transfer — triggered autonomously by Groq decision
const result = await tronAccount.transfer({
  token:     'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', // USDT TRC20 mainnet
  recipient: agentBTronAddress,
  amount:    BigInt(Math.round(tip * 1_000_000))     // 6 decimals
})

// Verify on Tron mainnet
console.log(`https://tronscan.org/#/transaction/${result.hash}`)
```

---

## Built on Intercom

This project builds on the [Intercom P2P stack](https://github.com/Trac-Systems/intercom) by Trac Systems — agents coordinate over Hyperswarm DHT with Noise XX encrypted channels and settle payments on-chain via WDK. The `0000intercom` topic is the global rendezvous sidechannel defined by the Intercom protocol.

---

## License

Apache-2.0

Copyright 2026 Albertbassey

---

*Submitted to Hackathon Galáctica: WDK Edition 1 — Agent Wallets Track*