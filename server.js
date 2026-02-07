/**************************************************
 * PHONEPE PG V2 BACKEND (BUBBLE COMPATIBLE)
 **************************************************/

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 10000;

/**************************************************
 * ENV VARIABLES (SET IN RENDER)
 **************************************************
 * PHONEPE_CLIENT_ID
 * PHONEPE_CLIENT_SECRET
 * PHONEPE_CLIENT_VERSION   (usually 1)
 * PHONEPE_ENV              (SANDBOX or PROD)
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
  console.error("❌ Missing PhonePe ENV variables");
}

/**************************************************
 * ACCESS TOKEN FUNCTION (V2)
 **************************************************/
async function getAccessToken() {
  const params = new URLSearchParams();
  params.append("client_id", PHONEPE.clientId);
  params.append("client_version", PHONEPE.clientVersion);
  params.append("client_secret", PHONEPE.clientSecret);
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

  return response.data.access_token;
}

/**************************************************
 * HEALTH CHECK
 **************************************************/
app.get("/", (req, res) => {
  res.send("✅ PhonePe PG V2 backend running");
});

/**************************************************
 * CREATE PAYMENT (USED BY BUBBLE)
 **************************************************/
app.post("/api/phonepe/create-payment", async (req, res) => {
  try {
    const { orderId, amount, redirectUrl } = req.body;

    if (!orderId || !amount || !redirectUrl) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // 1️⃣ Get Access Token
    const token = await getAccessToken();

    // 2️⃣ Payment Payload (V2)
    const payload = {
      merchantOrderId: orderId,
      amount: Number(amount), // amount in paise
      paymentFlow: {
        type: "PG_CHECKOUT",
        merchantUrls: {
          redirectUrl: redirectUrl,
        },
      },
    };

    // 3️⃣ Call PhonePe Create Payment API
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

    // 4️⃣ Return Payment URL to Bubble
    return res.json({
      success: true,
      paymentUrl:
        response.data.data.instrumentResponse.redirectInfo.url,
      raw: response.data,
    });

  } catch (error) {
    console.error(
      "❌ CREATE PAYMENT ERROR:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

/**************************************************
 * PAYMENT STATUS (OPTIONAL – FOR REDIRECT PAGE)
 **************************************************/
app.get("/api/phonepe/status/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    const token = await getAccessToken();

    const response = await axios.get(
      `${PHONEPE.baseUrl}/checkout/v2/order/${orderId}`,
      {
        headers: {
          Authorization: `O-Bearer ${token}`,
        },
      }
    );

    return res.json({
      success: true,
      status: response.data,
    });

  } catch (error) {
    console.error(
      "❌ STATUS ERROR:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

/**************************************************
 * START SERVER
 **************************************************/
app.listen(PORT, () => {
  console.log(`🚀 PhonePe PG V2 backend running on port ${PORT}`);
});
