# IntercomPayday 💸

Autonomous multi-chain AI agent wallet network — agents complete tasks and receive real **USD₮ (TRC20)** payments automatically via Tether WDK on Tron mainnet, coordinated over Intercom P2P sidechannels, with a live WebSocket bridge to a real-time browser UI.

Built for **Hackathon Galáctica: WDK Edition 1** — **Agent Wallets Track**

---

## What It Does

IntercomPayday is an autonomous agent payment network. AI agents monitor a P2P task board over Intercom sidechannels, reason about tasks using Groq Llama 3, and autonomously send real **USD₮ TRC20** payments via the Tether Wallet Development Kit (WDK) when tasks are completed — with zero human intervention. Every action is streamed live to a browser UI via WebSocket.

```
Autonomous loop ticks every 30s — no human input required
              ↓
Agent scans network, creates task from TASK_POOL
              ↓
Groq Llama 3 reasons: should I pick this up?
              ↓
Agent works on task for 15s
              ↓
Groq reasons: task done — send payment?
              ↓
Safety system validates: limits, balance, permissions
              ↓
WDK Tron wallet signs + sends USD₮ TRC20 to peer wallet
              ↓
TX hash confirmed on Tron mainnet → visible on Tronscan
              ↓
WebSocket broadcasts real tx hash + balance to browser UI
              ↓
WDK Solana logs coordination proof on Solana devnet
              ↓
Loop immediately queues next task — runs forever
```

---

## Track Requirements Met

| Requirement | Status | How |
|---|---|---|
| Agent framework for reasoning | ✅ | Groq Llama 3 8B (open-source LLM — bonus!) |
| WDK primitives directly | ✅ | `wallet.getAccount()`, `account.transfer()`, `account.getBalance()`, `account.getTokenBalance()` |
| Agent holds/sends USD₮ autonomously | ✅ | Real USDT TRC20 transfers on Tron mainnet via WDK |
| Clear separation: agent logic vs wallet | ✅ | Groq reasons → safety checks → WDK executes |
| Safety: permissions, limits, recovery | ✅ | Full dual-chain safety system — see below |
| Open-source LLM framework | ✅ | Groq Llama 3 8B |
| Composability with other agents | ✅ | Multi-agent P2P via Intercom (Hyperswarm) |
| Fully autonomous — no human input | ✅ | Loop picks up tasks, works, pays, re-queues — zero CLI trigger needed |

---

## Architecture

### Multi-Chain Wallet (one seed phrase — two chains)

```
Your 12-word BIP-39 seed phrase
        ↓  BIP-44 HD derivation
┌──────────────────────────┐    ┌──────────────────────────┐
│  WDK Tron                │    │  WDK Solana              │
│  m/44'/195'/0'/0'        │    │  m/44'/501'/0'/0'        │
│  Tron mainnet            │    │  Solana devnet           │
│  Real USD₮ TRC20         │    │  Agent coordination      │
└──────────────────────────┘    └──────────────────────────┘
```

| Chain | Purpose | Token | Network |
|---|---|---|---|
| **Tron** | Real value payments to task completers | USD₮ TRC20 | Mainnet |
| **Solana** | Agent coordination proofs, task history | SOL | Devnet |

### System Flow

```
┌─────────────────────────────────┐
│   BROWSER UI (index.html)       │  ← real-time task board
│   app.js WebSocket client       │     live balance + real tx hashes
└────────────┬────────────────────┘
             │ ws://localhost:8080
             ▼
┌─────────────────────────────────┐
│   AGENT LAYER (Groq Llama 3)    │  ← reasons, decides, plans
│   wallet-agent.js               │     WebSocket server :8080
└────────────┬────────────────────┘
             │ decision
             ▼
┌─────────────────────────────────┐
│   SAFETY LAYER                  │  ← validates limits, permissions
│   safetyCheck(amount, chain)    │     per-chain: USD₮ + SOL
└────────────┬────────────────────┘
             │ approved
             ▼
┌─────────────────────────────────┐
│   WALLET LAYER (Tether WDK)     │  ← signs, executes, confirms
│   WDK Tron  → USD₮ TRC20       │
│   WDK Solana → SOL devnet       │
└─────────────────────────────────┘
```

### WebSocket Event Protocol

**Agent → UI:**

| Event | Payload | Description |
|---|---|---|
| `balance:update` | `{ usdt, sol, tronAddress, solAddress }` | Live wallet balances |
| `agent:reasoning` | `{ text }` | Groq reasoning streamed live |
| `agent:action` | `{ action, details }` | Agent decision |
| `payment:sent` | `{ txHash, amount, chain, explorer }` | Real on-chain tx confirmed |
| `payment:blocked` | `{ reason, amount, chain }` | Safety system blocked payment |
| `payment:queued` | `{ recipient, amount, taskName }` | Awaiting supervised approval |
| `agent:paused` | `{ reason }` | Agent paused |
| `agent:resumed` | `{}` | Agent resumed |

**UI → Agent:**

| Command | Payload | Description |
|---|---|---|
| `task:create` | `{ title, desc, priority, tip, assignee }` | Submit task for reasoning |
| `task:complete` | `{ title, tip, assignee }` | Trigger real WDK payment |
| `task:start` | `{ title }` | Move task to in-progress |
| `agent:pause` | `{}` | Pause all payments |
| `agent:resume` | `{}` | Resume payments |
| `payment:confirm` | `{}` | Approve queued payment |
| `payment:reject` | `{}` | Reject queued payment |
| `balance:refresh` | `{}` | Force refresh from chain |

---

## Safety System

Every payment passes through `safetyCheck(amount, chain)` before WDK is ever called.

### Limits (configurable via `.env`)

| Limit | USD₮ (Tron) | SOL (Solana) |
|---|---|---|
| Max per transaction | 1.00 USD₮ | 0.10 SOL |
| Daily spending cap | 2.00 USD₮ | 0.50 SOL |
| Low balance warning | 1.00 USD₮ | 0.50 SOL |
| Hard stop (auto-pause) | 0.20 USD₮ | 0.10 SOL |

### Payment Roles

- **`autonomous`** — agent sends payments independently based on Groq reasoning
- **`supervised`** — every payment is queued; operator must `confirm` or `reject`

### Recovery

- WDK transfer failures trigger automatic wallet state refresh from chain
- All errors caught gracefully — agent never crashes
- Low balance warning broadcast to UI before hard stop
- Auto-pause triggers and notifies UI when balance drops below minimum

### Audit Log

- Every decision logged: timestamp, action, result, balances on both chains
- `audit` CLI command shows last 5 entries
- Last 100 entries kept in memory per session

---

## Tech Stack

| Layer | Technology |
|---|---|
| AI Reasoning | Groq Llama 3 8B (open-source LLM) |
| Wallet — real payments | `@tetherto/wdk-wallet-tron` |
| Wallet — agent proofs | `@tetherto/wdk-wallet-solana` |
| Real-time UI bridge | `ws` (WebSocket) |
| Real payments | USD₮ TRC20 on Tron mainnet |
| Agent coordination | SOL on Solana devnet |
| P2P Network | Intercom (Hyperswarm + Holepunch) |
| Key Derivation | BIP-39 + BIP-44 HD wallet (one seed, two chains) |
| Autonomous Loop | Self-managed task queue — picks up, works, pays, re-queues with no human input |
| Runtime | Node.js 18+ (ESM) |

---

## Project Structure

```
intercom-payday/
├── agent/
│   └── wallet-agent.js          # WDK Tron + Solana + Groq + WebSocket server + safety
├── ui/
│   └── intercom-payday/
│       ├── index.html           # App shell — multi-chain UI
│       ├── style.css            # Industrial-futurist design (gold on black)
│       └── app.js               # WebSocket client — live task board + real tx feed
├── .env.example                 # Dual-chain config template
├── package.json
└── README.md
```

---

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/Albertbassey/intercom-payday.git
cd intercom-payday
npm install
npm install @tetherto/wdk-wallet-tron ws
```

### 2. Configure

```bash
cp .env.example .env
# Fill in:
#   GROQ_API_KEY  — from console.groq.com
#   SEED_PHRASE        — your 12-word BIP-39 seed phrase
#   PEER_TRON_ADDRESS  — peer wallet address (e.g. Trust Wallet TRC20) that receives payments
```

### 3. Get Your Wallet Addresses

```bash
node agent/wallet-agent.js
```

On startup the agent prints both addresses:
```
Address (Tron)   : T...your-tron-address
Address (Solana) : ...your-solana-address
```

### 4. Fund Your Wallets

- **Tron address** → Send USD₮ TRC20 (~$2 minimum for demo)
  - Swap TRX → USDT TRC20 on [SunSwap](https://sun.io), send to your Tron address
- **Solana address** → Get free devnet SOL: https://faucet.solana.com
- **Peer wallet** → Set `PEER_TRON_ADDRESS` in `.env` to any external TRC20 wallet (e.g. Trust Wallet). The agent will autonomously send real USD₮ here when it completes tasks — confirming true cross-wallet payments on Tron mainnet

### 5. Run the Agent

```bash
node agent/wallet-agent.js
```

WebSocket server starts automatically on `ws://localhost:8080`.

### 6. Open the UI

Open `ui/intercom-payday/index.html` in your browser. The UI connects to the agent automatically — real wallet balances, Groq reasoning, and confirmed Tron tx hashes all update live.

---

## Agent CLI Commands

```
PaydayAgent > tip <tron-address> <amount>    — manual USD₮ TRC20 payment via WDK
PaydayAgent > loop                           — show autonomous loop queue (todo/in-progress/done)
PaydayAgent > balance                        — refresh + show USD₮ + SOL balances
PaydayAgent > safety                         — dual-chain safety limits & daily spend
PaydayAgent > audit                          — last 5 audit log entries
PaydayAgent > clients                        — number of connected UI clients
PaydayAgent > pause                          — suspend all payments (broadcasts to UI)
PaydayAgent > resume                         — re-enable payments (broadcasts to UI)
PaydayAgent > confirm                        — approve queued payment (supervised mode)
PaydayAgent > reject                         — reject queued payment (supervised mode)
PaydayAgent > quit                           — graceful shutdown with summary
```

---

## WDK Integration

```javascript
import WalletManagerSolana from '@tetherto/wdk-wallet-solana'
import WalletManagerTron   from '@tetherto/wdk-wallet-tron'

// One BIP-39 seed phrase — two chains, two WDK wallet instances
const solWallet  = new WalletManagerSolana(seedPhrase, { rpcUrl, transferMaxFee })
const tronWallet = new WalletManagerTron(seedPhrase,   { provider, transferMaxFee })

const tronAccount = await tronWallet.getAccount(0)

// Real USD₮ TRC20 transfer via WDK Tron
const result = await tronAccount.transfer({
  token:     'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', // USDT TRC20 mainnet
  recipient: recipientAddress,
  amount:    BigInt(Math.round(amount * 1_000_000))  // 6 decimals
})

// Real verifiable tx on Tronscan
console.log(`https://tronscan.org/#/transaction/${result.hash}`)
```

---

## Built on Intercom

This project extends the [Intercom P2P stack](https://github.com/Trac-Systems/intercom). Agents coordinate over Intercom sidechannels (Hyperswarm DHT + Noise XX protocol) and settle payments on-chain via WDK — creating a foundation for truly autonomous economic agents that hold, earn, and spend real value across multiple chains.

---

## License

Apache-2.0

---

*Submitted to Hackathon Galáctica: WDK Edition 1 — Agent Wallets Track*
*Built by Albertbassey*