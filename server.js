/**************************************************
 * PHONEPE PG V2 BACKEND (PRODUCTION-READY)
 **************************************************/

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 10000;

/**************************************************
 * CONFIG
 **************************************************/
const PHONEPE = {
  clientId: process.env.PHONEPE_CLIENT_ID,
  clientSecret: process.env.PHONEPE_CLIENT_SECRET,
  clientVersion: process.env.PHONEPE_CLIENT_VERSION || "1",
  baseUrl:
    process.env.PHONEPE_ENV === "PROD"
      ? "https://api.phonepe.com/apis"
      : "https://api-preprod.phonepe.com/apis/pg-sandbox",
};

if (!PHONEPE.clientId || !PHONEPE.clientSecret) {
  console.error("❌ Missing PhonePe credentials");
  process.exit(1);
}

/**************************************************
 * TOKEN CACHE (10min validity)
 **************************************************/
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  const now = Date.now();
  
  if (cachedToken && now < tokenExpiry) {
    return cachedToken;
  }

  const params = new URLSearchParams();
  params.append("client_id", PHONEPE.clientId);
  params.append("client_version", PHONEPE.clientVersion);
  params.append("client_secret", PHONEPE.clientSecret);
  params.append("grant_type", "client_credentials");

  const response = await axios.post(
    `${PHONEPE.baseUrl}/v1/token`,
    params,
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  cachedToken = response.data.access_token;
  tokenExpiry = now + 9 * 60 * 1000; // 9min buffer

  return cachedToken;
}

/**************************************************
 * HEALTH CHECK
 **************************************************/
app.get("/", (req, res) => {
  res.json({ 
    status: "running",
    env: process.env.PHONEPE_ENV || "SANDBOX"
  });
});

/**************************************************
 * CREATE PAYMENT
 **************************************************/
app.post("/api/phonepe/create-payment", async (req, res) => {
  try {
    const { orderId, amount, redirectUrl } = req.body;

    // Validation
    if (!orderId || !amount || !redirectUrl) {
      return res.status(400).json({
        success: false,
        message: "Missing: orderId, amount, or redirectUrl",
      });
    }

    const amountNum = Number(amount);
    if (isNaN(amountNum) || amountNum < 100) {
      return res.status(400).json({
        success: false,
        message: "Amount must be ≥100 paise (₹1)",
      });
    }

    // Get token
    const token = await getAccessToken();

    // Payment payload
    const payload = {
      merchantOrderId: orderId,
      amount: amountNum,
      paymentFlow: {
        type: "PG_CHECKOUT",
        merchantUrls: {
          redirectUrl: redirectUrl,
        },
      },
    };

    // Create payment
    const response = await axios.post(
      `${PHONEPE.baseUrl}/checkout/v2/pay`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    return res.json({
      success: true,
      paymentUrl:
        response.data.data.instrumentResponse.redirectInfo.url,
      orderId: orderId,
    });

  } catch (error) {
    console.error(
      "❌ CREATE PAYMENT:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      success: false,
      error: error.response?.data?.message || "Payment creation failed",
    });
  }
});

/**************************************************
 * PAYMENT STATUS
 **************************************************/
app.get("/api/phonepe/status/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const token = await getAccessToken();

    const response = await axios.get(
      `${PHONEPE.baseUrl}/checkout/v2/order/${orderId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    return res.json({
      success: true,
      status: response.data.data.status,
      amount: response.data.data.amount,
      orderId: orderId,
    });

  } catch (error) {
    console.error(
      "❌ STATUS CHECK:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      success: false,
      error: "Status check failed",
    });
  }
});

/**************************************************
 * START SERVER
 **************************************************/
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.PHONEPE_ENV || 'SANDBOX'}`);
});
```

---

