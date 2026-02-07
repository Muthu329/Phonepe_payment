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
   CHECKSUM GENERATOR (v2)
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
  res.send("✅ PhonePe backend running (v2)");
});

/* =========================
   INITIATE PAYMENT (v2)
========================= */
app.post("/api/phonepe/pay", async (req, res) => {
  try {
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
      amount: Number(amount) * 100, // convert to paise
      redirectUrl,
      redirectMode: "REDIRECT",
      callbackUrl,
      paymentInstrument: {
        type: "PAY_PAGE",
      },
    };

    const base64Payload = Buffer.from(
      JSON.stringify(payloadData)
    ).toString("base64");

    const checksum = generateChecksum(base64Payload, "/pg/v2/pay");

    const response = await axios.post(
      `${PHONEPE_CONFIG.apiUrl}/pg/v2/pay`,
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
    console.error("❌ PhonePe API ERROR:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

/* =========================
   CHECK PAYMENT STATUS (v2)
========================= */
app.get("/api/phonepe/status/:transactionId", async (req, res) => {
  try {
    const { transactionId } = req.params;

    if (!transactionId) {
      return res.status(400).json({
        success: false,
        error: "Transaction ID is required",
      });
    }

    const endpoint = `/pg/v2/status/${PHONEPE_CONFIG.merchantId}/${transactionId}`;
    const checksum = generateChecksum("", endpoint); // empty payload for status check

    const response = await axios.get(`${PHONEPE_CONFIG.apiUrl}${endpoint}`, {
      headers: {
        "Content-Type": "application/json",
        "X-VERIFY": checksum,
        "X-MERCHANT-ID": PHONEPE_CONFIG.merchantId,
      },
    });

    return res.json({
      success: true,
      status: response.data,
    });
  } catch (error) {
    console.error("❌ PhonePe STATUS API ERROR:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

/* =========================
   CALLBACK VERIFICATION (v2)
========================= */
app.post("/api/phonepe/callback", async (req, res) => {
  try {
    console.log("📩 CALLBACK RECEIVED:", req.body);

    const base64Payload = req.body.response;
    if (!base64Payload) {
      return res.status(400).json({
        success: false,
        error: "Missing response payload",
      });
    }

    const decodedPayload = JSON.parse(
      Buffer.from(base64Payload, "base64").toString("utf8")
    );

    console.log("🔎 DECODED CALLBACK PAYLOAD:", decodedPayload);

    const endpoint =
      "/pg/v2/status/" +
      PHONEPE_CONFIG.merchantId +
      "/" +
      decodedPayload.merchantTransactionId;

    const expectedChecksum = generateChecksum(base64Payload, endpoint);
    const receivedChecksum = req.headers["x-verify"];

    if (expectedChecksum !== receivedChecksum) {
      console.error("❌ Invalid checksum in callback");
      return res.status(400).json({
        success: false,
        error: "Checksum mismatch",
      });
    }

    console.log("✅ Callback verified successfully");

    if (decodedPayload.code === "PAYMENT_SUCCESS") {
      console.log("💰 Payment successful for:", decodedPayload.merchantTransactionId);
      // TODO: Update DB here
    } else {
      console.log("⚠️ Payment not successful:", decodedPayload.code);
    }

    return res.json({
      success: true,
      data: decodedPayload,
    });
  } catch (error) {
    console.error("❌ CALLBACK ERROR:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`🚀 PhonePe middleware (v2) running on port ${PORT}`);
});
