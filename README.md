# IntercomPayday 💸

> Autonomous AI agent wallet network — agents complete tasks and receive Solana payments automatically via Tether WDK on Solana, coordinated over Intercom P2P sidechannels.

Built for **Hackathon Galáctica: WDK Edition 1** — **Agent Wallets Track**

---

## What It Does

IntercomPayday is an autonomous agent payment network. AI agents monitor a P2P task board over Intercom sidechannels, reason about tasks using Groq Llama 3, and autonomously send Solana payments via the Tether Wallet Development Kit (WDK) when tasks are completed.

```
Agent monitors 0000intercom P2P sidechannel
              ↓
Groq Llama 3 reasons: should I pick up this task?
              ↓
Agent completes task autonomously
              ↓
Safety system validates: limits, balance, permissions
              ↓
WDK wallet signs + sends Sol on Solana
              ↓
TX hash confirmed on-chain, visible on Solana Explorer
```

---

## Track Requirements Met

| Requirement | Status | How |
|---|---|---|
| Agent framework for reasoning | ✅ | Groq Llama 3 (open-source LLM — bonus!) |
| WDK primitives directly | ✅ | `wallet.getAccount()`, `account.transfer()`, `account.getBalance()` |
| Agent holds/sends Solana autonomously | ✅ | Autonomous task loop with real WDK transfers |
| Clear separation: agent logic vs wallet | ✅ | `app.js` (reasoning) vs `wallet-agent.js` (WDK execution) |
| Safety: permissions, limits, recovery | ✅ | Full safety system — see below |
| Open-source LLM framework | ✅ | Groq Llama 3 8B (bonus point) |

---

## Safety System

IntercomPayday implements a comprehensive safety layer between the AI agent and the WDK wallet. Every payment passes through `safetyCheck()` before WDK is ever called.

### Limits
- **Max tip per transaction** — agent cannot send more than `MAX_TIP_PER_TX` USDT in a single payment
- **Daily spending cap** — agent auto-pauses when `DAILY_SPENDING_CAP` is reached, resets at midnight
- **Hard stop** — all payments blocked if balance drops below `MIN_BALANCE_STOP`

### Permissions
- **`autonomous` mode** — agent sends payments independently based on Groq reasoning
- **`supervised` mode** — every payment is queued; human operator must type `confirm` or `reject`
- Set via `PAYMENT_ROLE` in `.env`

### Recovery
- If a WDK transfer fails, agent automatically refreshes wallet state from chain
- Errors are caught gracefully — agent never crashes, always recovers
- Low balance triggers warning before hard stop

### Audit Log
- Every decision is logged with timestamp, action, result, and balance after
- View with `audit` command in CLI
- Last 100 entries kept in memory per session

---

## Architecture

```
intercom-payday/
├── agent/
│   └── wallet-agent.js     # WDK wallet + Groq reasoning + safety system
├── ui/
│   └── intercom-payday/
│       ├── index.html       # App shell
│       ├── style.css        # Industrial-futurist UI
│       └── app.js           # Task board + autonomous agent loop
├── .env.example             # Config template (safety limits included)
├── package.json             # Apache-2.0
└── README.md
```

### Separation of Concerns

```
┌─────────────────────────────────┐
│     AGENT LAYER (Groq LLM)      │  ← reasons, decides, plans
│   app.js / wallet-agent.js      │
└────────────┬────────────────────┘
             │ decision
             ▼
┌─────────────────────────────────┐
│      SAFETY LAYER               │  ← validates limits, permissions
│      safetyCheck()              │
└────────────┬────────────────────┘
             │ approved
             ▼
┌─────────────────────────────────┐
│   WALLET LAYER (Tether WDK)     │  ← signs, executes, confirms
│   @tetherto/wdk-wallet-solana   │
└─────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| AI Reasoning | Groq Llama 3 8B (open-source LLM) |
| Wallet | `@tetherto/wdk-wallet-solana` |
| Blockchain | Solana (devnet / mainnet) |
| Token | USDT SPL (`Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`) |
| P2P Network | Intercom (Hyperswarm + Holepunch) |
| Key Derivation | BIP-39 seed phrase + BIP-44 HD wallet |
| Runtime | Node.js 18+ (ESM) |

---

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/Albertbassey/intercom-payday.git
cd intercom-payday
npm install
```

### 2. Configure

```bash
cp .env.example .env
# Fill in GROQ_API_KEY and SEED_PHRASE
```

Get free devnet SOL: https://faucet.solana.com

### 3. Run the Agent

```bash
node agent/wallet-agent.js
```

### 4. Open the UI

Open `ui/intercom-payday/index.html` in your browser.

---

## Agent CLI Commands

```
PaydayAgent > task <title> <priority> <tip>   — submit task for AI evaluation
PaydayAgent > complete <title>                — complete task + trigger payment
PaydayAgent > think <question>               — ask Groq to reason about anything
PaydayAgent > tip <address> <amount>         — manual USDT payment via WDK
PaydayAgent > balance                        — check SOL + USDT balances
PaydayAgent > safety                         — show safety limits & daily spend
PaydayAgent > audit                          — show last 5 audit log entries
PaydayAgent > memory                         — show session stats
PaydayAgent > pause                          — suspend all payments
PaydayAgent > resume                         — re-enable payments
PaydayAgent > confirm                        — approve queued payment (supervised mode)
PaydayAgent > reject                         — reject queued payment (supervised mode)
PaydayAgent > quit                           — graceful shutdown with summary
```

---

## WDK Integration

```javascript
import WalletManagerSolana from '@tetherto/wdk-wallet-solana'

// Initialise WDK wallet from BIP-39 seed phrase
const wallet  = new WalletManagerSolana(seedPhrase, {
  rpcUrl:         'https://api.devnet.solana.com',
  transferMaxFee: 10_000_000  // 0.01 SOL max gas
})

const account = await wallet.getAccount(0)
const address = await account.getAddress()

// Safety check before any payment
const check = safetyCheck(amount)
if (!check.safe) return // block payment

// Send Solana via WDK
const result = await account.transfer({
  token:     'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  recipient: recipientAddress,
  amount:    BigInt(Math.round(amount * 1_000_000))
}, { commitment: 'confirmed' })

console.log('TX confirmed:', result.hash)
// https://explorer.solana.com/tx/<hash>?cluster=devnet
```

---

## Built on Intercom

This project extends the [Intercom P2P stack](https://github.com/Trac-Systems/intercom). Agents coordinate over Intercom sidechannels (Hyperswarm DHT + Noise XX protocol) and settle payments on-chain via WDK — creating a foundation for truly autonomous economic agents.

---

## License

Apache-2.0 — see [LICENSE](LICENSE)

---

*Submitted to Hackathon Galáctica: WDK Edition 1 — Agent Wallets Track*  
*Built by Albertbassey*