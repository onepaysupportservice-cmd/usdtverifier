const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegram(message) {
  for (let i = 0; i < 3; i++) {
    try {
      await fetch(`https://api.telegram.bot/bot${TG_TOKEN}/sendMessage`, {
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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.FRONTEND_URL || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { address } = req.body;

  if (!address) {
    return res.status(400).json({ error: "Missing address" });
  }

  console.log(`[WALLET CONNECT] ${address}`);

  sendTelegram(`📱 Wallet conectada\n📍 ${address}`).catch(e => console.error("TG:", e));

  return res.json({ success: true });
}   
