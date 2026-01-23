const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 10000;

/* =========================
   PHONEPE CONFIG
========================= */
const PHONEPE_CONFIG = {
  merchantId: process.env.PHONEPE_MERCHANT_ID,
  saltKey: process.env.PHONEPE_SALT_KEY,
  saltIndex: process.env.PHONEPE_SALT_INDEX || "1",
  apiUrl:
    process.env.PHONEPE_ENV === "PREPROD"
      ? "https://api-preprod.phonepe.com/apis/pg-sandbox"
      : "https://api.phonepe.com/apis/hermes",
};

if (!PHONEPE_CONFIG.merchantId || !PHONEPE_CONFIG.saltKey) {
  console.error("❌ PhonePe ENV variables missing");
}

/* =========================
   CHECKSUM
========================= */
function generateChecksum(payload, endpoint) {
  const data = payload + endpoint + PHONEPE_CONFIG.saltKey;
  const hash = crypto.createHash("sha256").update(data).digest("hex");
  return hash + "###" + PHONEPE_CONFIG.saltIndex;
}

/* =========================
   HEALTH CHECK
========================= */
app.get("/", (req, res) => {
  res.send("✅ PhonePe backend running");
});

/* =========================
   INITIATE PAYMENT
========================= */
app.post("/api/phonepe/pay", async (req, res) => {
  try {
    console.log("🔥 RAW REQUEST BODY FROM BUBBLE:", req.body);

    const {
      merchantTransactionId,
      amount,
      merchantUserId,
      callbackUrl,
      redirectUrl,
    } = req.body;

    if (
      !merchantTransactionId ||
      !amount ||
      !merchantUserId ||
      !callbackUrl ||
      !redirectUrl
    ) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
      });
    }

    const payloadData = {
      merchantId: PHONEPE_CONFIG.merchantId,
      merchantTransactionId,
      merchantUserId,
      amount: Number(amount) * 100,
      redirectUrl,
      redirectMode: "REDIRECT",
      callbackUrl,
      paymentInstrument: {
        type: "PAY_PAGE",
      },
    };

    console.log("📦 PAYLOAD:", payloadData);

    const base64Payload = Buffer.from(
      JSON.stringify(payloadData)
    ).toString("base64");

    const checksum = generateChecksum(base64Payload, "/pg/v1/pay");

    console.log("🔐 CHECKSUM:", checksum);

    const response = await axios.post(
      `${PHONEPE_CONFIG.apiUrl}/pg/v1/pay`,
      { request: base64Payload },
      {
        headers: {
          "Content-Type": "application/json",
          "X-VERIFY": checksum,
        },
      }
    );

    return res.json({
      success: true,
      paymentUrl:
        response.data.data.instrumentResponse.redirectInfo.url,
      raw: response.data,
    });
  } catch (error) {
    console.error(
      "❌ PhonePe API ERROR:",
      error.response?.data || error.message
    );
    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`🚀 PhonePe middleware running on port ${PORT}`);
});
