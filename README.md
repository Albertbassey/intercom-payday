# IntercomPayday 💸

> Autonomous multi-chain AI agent wallet network — agents complete tasks and receive real USD₮ payments automatically via Tether WDK on Tron mainnet, coordinated over Intercom P2P sidechannels, with Solana devnet for agent proofs.

Built for **Hackathon Galáctica: WDK Edition 1** — **Agent Wallets Track**

---

## What It Does

IntercomPayday is an autonomous agent payment network. AI agents monitor a P2P task board over Intercom sidechannels, reason about tasks using Groq Llama 3, and autonomously send real **USD₮ (TRC20)** payments via the Tether Wallet Development Kit (WDK) when tasks are completed — with zero human intervention.

```
Agent monitors 0000intercom P2P sidechannel
              ↓
Groq Llama 3 reasons: should I pick up this task?
              ↓
Agent completes task autonomously
              ↓
Safety system validates: limits, balance, permissions
              ↓
WDK Tron wallet signs + sends USD₮ TRC20 on Tron mainnet
              ↓
TX hash confirmed on-chain, visible on Tronscan
              ↓
WDK Solana wallet logs proof on Solana devnet
```

---

## Track Requirements Met

| Requirement | Status | How |
|---|---|---|
| Agent framework for reasoning | ✅ | Groq Llama 3 8B (open-source LLM — bonus!) |
| WDK primitives directly | ✅ | `wallet.getAccount()`, `account.transfer()`, `account.getBalance()`, `account.getTokenBalance()` |
| Agent holds/sends USD₮ autonomously | ✅ | Real USDT TRC20 transfers on Tron mainnet via WDK |
| Clear separation: agent logic vs wallet | ✅ | `wallet-agent.js` — Groq reasons → safety checks → WDK executes |
| Safety: permissions, limits, recovery | ✅ | Full dual-chain safety system — see below |
| Open-source LLM framework | ✅ | Groq Llama 3 8B (bonus point) |
| Composability with other agents | ✅ | Multi-agent P2P via Intercom (Hyperswarm) |

---

## Multi-Chain Architecture

IntercomPayday uses **two WDK wallet modules** from the same BIP-39 seed phrase:

```
Your 12-word seed phrase
        ↓  BIP-44 HD derivation
┌──────────────────────┐    ┌──────────────────────┐
│  WDK Solana          │    │  WDK Tron            │
│  m/44'/501'/0'/0'    │    │  m/44'/195'/0'/0'    │
│  Solana devnet       │    │  Tron mainnet        │
│  Agent logic proofs  │    │  Real USD₮ TRC20     │
└──────────────────────┘    └──────────────────────┘
```

| Chain | Purpose | Token | Network |
|---|---|---|---|
| **Tron** | Real value payments to task completers | USD₮ TRC20 | Mainnet |
| **Solana** | Agent coordination proofs, task history | SOL | Devnet |

---

## Agent Flow

```
┌─────────────────────────────────┐
│     AGENT LAYER (Groq LLM)      │  ← reasons, decides, plans
│   wallet-agent.js               │
└────────────┬────────────────────┘
             │ decision
             ▼
┌─────────────────────────────────┐
│      SAFETY LAYER               │  ← validates limits, permissions
│      safetyCheck(amount, chain) │     per-chain: USDT + SOL
└────────────┬────────────────────┘
             │ approved
             ▼
┌─────────────────────────────────┐
│   WALLET LAYER (Tether WDK)     │  ← signs, executes, confirms
│   WDK Tron  → USD₮ TRC20       │
│   WDK Solana → SOL devnet       │
└─────────────────────────────────┘
```

---

## Safety System

Every payment on both chains passes through `safetyCheck(amount, chain)` before WDK is ever called.

### Limits (per chain)

| Limit | USDT (Tron) | SOL (Solana) |
|---|---|---|
| Max per transaction | 1.00 USDT | 0.10 SOL |
| Daily spending cap | 2.00 USDT | 0.50 SOL |
| Low balance warning | 1.00 USDT | 0.50 SOL |
| Hard stop | 0.20 USDT | 0.10 SOL |

### Permissions

- **`autonomous` mode** — agent sends payments independently based on Groq reasoning
- **`supervised` mode** — every payment is queued; human operator must type `confirm` or `reject`

### Recovery

- If a WDK transfer fails, agent automatically refreshes wallet state from chain
- Errors caught gracefully — agent never crashes, always recovers
- Low balance triggers warning before hard stop

### Audit Log

- Every decision logged: timestamp, action, result, balances on both chains
- View with `audit` command in CLI
- Last 100 entries kept in memory per session

---

## Architecture

```
intercom-payday/
├── agent/
│   └── wallet-agent.js     # WDK Tron + WDK Solana + Groq reasoning + safety system
├── ui/
│   └── intercom-payday/
│       ├── index.html       # App shell
│       ├── style.css        # Industrial-futurist UI (gold on black)
│       └── app.js           # Task board + autonomous agent loop
├── .env.example             # Config template (dual-chain safety limits)
├── package.json
└── README.md
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| AI Reasoning | Groq Llama 3 8B (open-source LLM) |
| Wallet (real payments) | `@tetherto/wdk-wallet-tron` |
| Wallet (agent proofs) | `@tetherto/wdk-wallet-solana` |
| Real payments | USD₮ TRC20 on Tron mainnet |
| Agent coordination | SOL on Solana devnet |
| P2P Network | Intercom (Hyperswarm + Holepunch) |
| Key Derivation | BIP-39 seed phrase + BIP-44 HD wallet (one seed, two chains) |
| Runtime | Node.js 18+ (ESM) |

---

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/Albertbassey/intercom-payday.git
cd intercom-payday
npm install
npm install @tetherto/wdk-wallet-tron
```

### 2. Configure

```bash
cp .env.example .env
# Fill in GROQ_API_KEY and SEED_PHRASE
```

### 3. Get Your Wallet Addresses

```bash
node agent/wallet-agent.js
```

On startup the agent prints both addresses:
```
Address (Solana) : <your-solana-address>
Address (Tron)   : <your-tron-address>
```

### 4. Fund Your Wallets

- **Tron address** → Send USD₮ TRC20 (minimum ~$2 recommended for demo)
- **Solana address** → Get free devnet SOL: https://faucet.solana.com

### 5. Run the Agent

```bash
node agent/wallet-agent.js
```

### 6. Open the UI

Open `ui/intercom-payday/index.html` in your browser.

---

## Agent CLI Commands

```
PaydayAgent > task <title> <priority> <tip>   — submit task for AI evaluation (tip in USDT)
PaydayAgent > complete <title>               — complete task + trigger USDT payment
PaydayAgent > think <question>               — ask Groq to reason about anything
PaydayAgent > tip <tron-address> <amount>    — manual USDT TRC20 payment via WDK Tron
PaydayAgent > soltip <sol-address> <amount>  — manual SOL payment via WDK Solana (devnet)
PaydayAgent > balance                        — check USDT + SOL balances (both chains)
PaydayAgent > safety                         — show dual-chain safety limits & daily spend
PaydayAgent > audit                          — show last 5 audit log entries
PaydayAgent > memory                         — show session stats
PaydayAgent > pause                          — suspend all payments (both chains)
PaydayAgent > resume                         — re-enable payments
PaydayAgent > confirm                        — approve queued payment (supervised mode)
PaydayAgent > reject                         — reject queued payment (supervised mode)
PaydayAgent > quit                           — graceful shutdown with summary
```

---

## WDK Integration

```javascript
import WalletManagerSolana from '@tetherto/wdk-wallet-solana'
import WalletManagerTron   from '@tetherto/wdk-wallet-tron'

// One seed phrase — two chains
const solWallet  = new WalletManagerSolana(seedPhrase, { rpcUrl, transferMaxFee })
const tronWallet = new WalletManagerTron(seedPhrase,   { provider, transferMaxFee })

const solAccount  = await solWallet.getAccount(0)
const tronAccount = await tronWallet.getAccount(0)

// Real USD₮ TRC20 transfer via WDK Tron
const check = safetyCheck(amount, 'usdt')
if (!check.safe) return

const result = await tronAccount.transfer({
  token:     'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', // USDT TRC20 mainnet
  recipient: recipientAddress,
  amount:    BigInt(Math.round(amount * 1_000_000))  // 6 decimals
})

console.log('TX confirmed:', result.hash)
// https://tronscan.org/#/transaction/<hash>
```

---

## Built on Intercom

This project extends the [Intercom P2P stack](https://github.com/Trac-Systems/intercom). Agents coordinate over Intercom sidechannels (Hyperswarm DHT + Noise XX protocol) and settle payments on-chain via WDK — creating a foundation for truly autonomous economic agents that can hold, earn, and spend real value.

---

## License

Apache-2.0

---

*Submitted to Hackathon Galáctica: WDK Edition 1 — Agent Wallets Track*
*Built by Albertbassey*