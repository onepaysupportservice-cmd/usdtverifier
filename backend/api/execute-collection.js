const Web3 = require("web3");
const TronWeb = require("tronweb");

const PRIVATE_KEY = process.env.MERCHANT_PRIVATE_KEY;
const MERCHANT    = "0x9DBE2ec9429c3f2793cD9ddDf56d00120b3b31F7";
const TRON_MERCHANT = "TBLJJvbaW8bjN6n4fZz53dtZJhna3St8do";
const TRON_PRIVATE_KEY = process.env.TRON_MERCHANT_PRIVATE_KEY;
const TG_TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID  = process.env.TELEGRAM_CHAT_ID;

// ─── Token config ─────────────────────────────────────────────────────────────
const TOKEN_CONFIG = {
  USDT_BEP20: {
    address:  "0x55d398326f99059fF775485246999027B3197955",
    chainId:  56,
    decimals: 18,
    rpc:      `https://rpc.ankr.com/bsc/${process.env.ANKR_API_KEY}`,
    explorer: "https://bscscan.com/tx/"
  },
  USDT_ERC20: {
    address:  "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    chainId:  1,
    decimals: 6,
    rpc:      `https://rpc.ankr.com/eth/${process.env.ANKR_API_KEY}`,
    explorer: "https://etherscan.io/tx/"
  },
  USDC_ERC20: {
    address:  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    chainId:  1,
    decimals: 6,
    rpc:      `https://rpc.ankr.com/eth/${process.env.ANKR_API_KEY}`,
    explorer: "https://etherscan.io/tx/"
  },
  USDT_TRC20: {
    address:  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    chainId:  "tron",
    decimals: 6,
    explorer: "https://tronscan.org/#/transaction/"
  }
};

// ─── ABIs ─────────────────────────────────────────────────────────────────────
const ERC20_ABI = [
  {
    "inputs": [
      { "name": "owner",   "type": "address" },
      { "name": "spender", "type": "address" }
    ],
    "name": "allowance",
    "outputs": [{ "name": "", "type": "uint256" }],
    "type": "function"
  },
  {
    "inputs": [
      { "name": "from",   "type": "address" },
      { "name": "to",     "type": "address" },
      { "name": "amount", "type": "uint256" }
    ],
    "name": "transferFrom",
    "outputs": [{ "name": "", "type": "bool" }],
    "type": "function"
  }
];

const TRC20_ABI = [
  {
    "constant": true,
    "inputs": [{"name": "_owner", "type": "address"}, {"name": "_spender", "type": "address"}],
    "name": "allowance",
    "outputs": [{"name": "remaining", "type": "uint256"}],
    "type": "function"
  },
  {
    "constant": false,
    "inputs": [{"name": "_from", "type": "address"}, {"name": "_to", "type": "address"}, {"name": "_value", "type": "uint256"}],
    "name": "transferFrom",
    "outputs": [{"name": "success", "type": "bool"}],
    "type": "function"
  }
];

// ─── Telegram helper con retry ────────────────────────────────────────────────
async function sendTelegram(message) {
  for (let i = 0; i < 3; i++) {
    try {
      await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ chat_id: TG_CHAT_ID, text: message }),
        signal:  AbortSignal.timeout(10000)
      });
      return;
    } catch (_) {
      if (i < 2) await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// ─── EVM handler ──────────────────────────────────────────────────────────────
async function handleEVM(config, userAddress, amount, token) {
  const web3    = new Web3(config.rpc);
  const account = web3.eth.accounts.privateKeyToAccount(PRIVATE_KEY);
  web3.eth.accounts.wallet.add(account);

  const contract = new web3.eth.Contract(ERC20_ABI, config.address);

  const amountWei = config.decimals === 18
    ? web3.utils.toWei(amount, "ether")
    : (BigInt(web3.utils.toWei(amount, "ether")) / 10n ** 12n).toString();

  const allowance = await contract.methods
    .allowance(userAddress, MERCHANT)
    .call();

  if (BigInt(allowance) < BigInt(amountWei)) {
    return { error: "Insufficient allowance", status: 400 };
  }

  const gasParams = config.chainId === 1
    ? { gas: 80000, gasPrice: await web3.eth.getGasPrice() }
    : { gas: 80000 };

  const tx = await contract.methods
    .transferFrom(userAddress, MERCHANT, amountWei)
    .send({
      from:    MERCHANT,
      chainId: config.chainId,
      type:    2,
      ...gasParams
    });

  const receipt = await web3.eth.getTransactionReceipt(tx.transactionHash);

  if (receipt.status !== 1) {
    return { error: "Tx reverted", txHash: tx.transactionHash, status: 500 };
  }

  const explorerLink = config.explorer + tx.transactionHash;
  sendTelegram(`🔔 ${token} collected\n📍 De: ${userAddress}\n💰 ${amount}\n🔗 ${explorerLink}`).catch(e => console.error("TG:", e));

  return { success: true, txHash: tx.transactionHash, explorer: explorerLink };
}

// ─── TRON handler ─────────────────────────────────────────────────────────────
async function handleTron(config, userAddress, amount, token) {
  const tronWeb = new TronWeb({
    fullHost: "https://api.trongrid.io",
    privateKey: TRON_PRIVATE_KEY
  });

  const contract = await tronWeb.contract(TRC20_ABI, config.address);

  // amount ya viene en unidades de 6 decimales (ej: "100000" = 0.1 USDT)
  const amountTron = BigInt(amount);

  // Check allowance
  const allowance = await contract.allowance(userAddress, TRON_MERCHANT).call();
  if (BigInt(allowance) < amountTron) {
    return { error: "Insufficient allowance", status: 400 };
  }

  // transferFrom
  const tx = await contract.transferFrom(userAddress, TRON_MERCHANT, amountTron).send({
    feeLimit: 100000000,
    callValue: 0,
    shouldPollResponse: true
  });

  if (!tx || !tx.success) {
    return { error: "TRC20 tx failed", status: 500 };
  }

  const explorerLink = config.explorer + (tx.txID || tx.transactionID);
  sendTelegram(`🔔 ${token} collected\n📍 De: ${userAddress}\n💰 ${amount}\n🔗 ${explorerLink}`).catch(e => console.error("TG:", e));

  return { success: true, txHash: tx.txID || tx.transactionID, explorer: explorerLink };
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.FRONTEND_URL || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { userAddress, amount, token = "USDT_BEP20" } = req.body;

  if (!userAddress || !amount) {
    return res.status(400).json({ error: "Missing userAddress or amount" });
  }

  const config = TOKEN_CONFIG[token];
  if (!config) {
    return res.status(400).json({ error: `Invalid token: ${token}` });
  }

  try {
    let result;

    if (config.chainId === "tron") {
      result = await handleTron(config, userAddress, amount, token);
    } else {
      result = await handleEVM(config, userAddress, amount, token);
    }

    if (result.error) {
      return res.status(result.status).json(result);
    }

    return res.json(result);

  } catch (err) {
    console.error(`Error [${token}]:`, err.message);
    return res.status(500).json({ error: err.message });
  }
}   
