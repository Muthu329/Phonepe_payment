const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 10000;

/* =========================
   PHONEPE CONFIG (V2)
========================= */
const PHONEPE = {
  clientId: process.env.PHONEPE_CLIENT_ID,
  clientSecret: process.env.PHONEPE_CLIENT_SECRET,
  clientVersion: process.env.PHONEPE_CLIENT_VERSION || "1",
  baseUrl:
    process.env.PHONEPE_ENV === "SANDBOX"
      ? "https://api-preprod.phonepe.com/apis/pg-sandbox"
      : "https://api.phonepe.com/apis/pg",
};

let accessToken = null;
let tokenExpiry = 0;

/* =========================
   GET ACCESS TOKEN
========================= */
async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken;
  }

  const params = new URLSearchParams();
  params.append("client_id", PHONEPE.clientId);
  params.append("client_secret", PHONEPE.clientSecret);
  params.append("client_version", PHONEPE.clientVersion);
  params.append("grant_type", "client_credentials");

  const response = await axios.post(
    `${PHONEPE.baseUrl}/v1/oauth/token`,
    params,
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  accessToken = response.data.access_token;
  tokenExpiry = response.data.expires_at * 1000;

  return accessToken;
}

/* =========================
   HEALTH CHECK
========================= */
app.get("/", (_, res) => {
  res.send("✅ PhonePe V2 backend running");
});

/* =========================
   CREATE PAYMENT
========================= */
app.post("/api/phonepe/create-payment", async (req, res) => {
   res.json({ ok: true });
});
  try {
    const show = console.log;

    const { orderId, amount, redirectUrl } = req.body;

    if (!orderId || !amount || !redirectUrl) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const token = await getAccessToken();

    const payload = {
      merchantOrderId: orderId,
      amount: Number(amount), // already in paise
      paymentFlow: {
        type: "PG_CHECKOUT",
        merchantUrls: {
          redirectUrl,
        },
      },
    };

    const response = await axios.post(
      `${PHONEPE.baseUrl}/checkout/v2/pay`,
      payload,
      {
        headers: {
          Authorization: `O-Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    return res.json({
      success: true,
      redirectUrl: response.data.data.instrumentResponse.redirectInfo.url,
      raw: response.data,
    });
  } catch (err) {
    console.error("❌ CREATE PAYMENT ERROR:", err.response?.data || err.message);
    return res.status(500).json({
      success: false,
      error: err.response?.data || err.message,
    });
  }
});

/* =========================
   PAYMENT STATUS
========================= */
app.get("/api/phonepe/status/:orderId", async (req, res) => {
  try {
    const token = await getAccessToken();

    const response = await axios.get(
      `${PHONEPE.baseUrl}/checkout/v2/order/${req.params.orderId}`,
      {
        headers: {
          Authorization: `O-Bearer ${token}`,
        },
      }
    );

    res.json(response.data);
  } catch (err) {
    res.status(500).json(err.response?.data || err.message);
  }
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`🚀 PhonePe V2 server running on ${PORT}`);
});
