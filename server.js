const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

/* ======================================================
   PHONEPE CONFIG (ENV ONLY — NO HARDCODED KEYS)
====================================================== */
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

/* ======================================================
   CHECKSUM GENERATION (CORRECT)
====================================================== */
function generateChecksum(payload, endpoint) {
  const data = payload + endpoint + PHONEPE_CONFIG.saltKey;
  const sha256 = crypto.createHash("sha256").update(data).digest("hex");
  return sha256 + "###" + PHONEPE_CONFIG.saltIndex;
}

/* ======================================================
   HEALTH CHECK
====================================================== */
app.get("/", (req, res) => {
  res.send("✅ PhonePe backend running");
});

/* ======================================================
   INITIATE PAYMENT (NO EXTRA FIELDS — SANDBOX SAFE)
====================================================== */
app.post("/api/phonepe/pay", async (req, res) => {
  try {
    const {
      merchantTransactionId,
      amount,
      merchantUserId,
      callbackUrl,
      redirectUrl,
    } = req.body;

    // 🔴 STRICT VALIDATION
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

    // 🔴 PhonePe requires PAISA
    const payloadData = {
      merchantId: PHONEPE_CONFIG.merchantId,
      merchantTransactionId: merchantTransactionId,
      merchantUserId: merchantUserId,
      amount: Number(amount) * 100,
      redirectUrl: redirectUrl,
      redirectMode: "REDIRECT",
      callbackUrl: callbackUrl,
      paymentInstrument: {
        type: "PAY_PAGE",
      },
    };

    // DEBUG (keep while testing)
    console.log("📦 Payload:", payloadData);

    const base64Payload = Buffer.from(
      JSON.stringify(payloadData)
    ).toString("base64");

    const checksum = generateChecksum(base64Payload, "/pg/v1/pay");

    console.log("🔐 Checksum:", checksum);

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
      "❌ PhonePe API Error:",
      error.response?.data || error.message
    );
    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

/* ======================================================
   PAYMENT STATUS CHECK
====================================================== */
app.post("/api/phonepe/status", async (req, res) => {
  try {
    const { merchantTransactionId } = req.body;

    if (!merchantTransactionId) {
      return res.status(400).json({
        success: false,
        error: "merchantTransactionId required",
      });
    }

    const endpoint = `/pg/v1/status/${PHONEPE_CONFIG.merchantId}/${merchantTransactionId}`;
    const checksum = generateChecksum("", endpoint);

    const response = await axios.get(
      `${PHONEPE_CONFIG.apiUrl}${endpoint}`,
      {
        headers: {
          "Content-Type": "application/json",
          "X-VERIFY": checksum,
          "X-MERCHANT-ID": PHONEPE_CONFIG.merchantId,
        },
      }
    );

    return res.json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    console.error(
      "❌ PhonePe Status Error:",
      error.response?.data || error.message
    );
    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

/* ======================================================
   START SERVER
====================================================== */
app.listen(PORT, () => {
  console.log(`🚀 PhonePe middleware running on port ${PORT}`);
});
