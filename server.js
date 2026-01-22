const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

// PhonePe Config (replace with your credentials)
const PHONEPE_CONFIG = {
  merchantId: process.env.PHONEPE_MERCHANT_ID || 'M23YO4XQC3MUV_2601212129',
  saltKey: process.env.PHONEPE_SALT_KEY || 'ZWEyNmU0ZTQtYjE3Ni00NWQ1LTg3YjctNmVmOGY4NTU0YjA4',
  saltIndex: process.env.PHONEPE_SALT_INDEX || '1',
  apiUrl: process.env.PHONEPE_ENV === 'PREPROD' 
    ? 'https://api.phonepe.com/apis/hermes' 
    : 'https://api-preprod.phonepe.com/apis/pg-sandbox'
};

// Generate SHA256 checksum
function generateChecksum(payload, endpoint) {
  const string = payload + endpoint + PHONEPE_CONFIG.saltKey;
  const sha256 = crypto.createHash('sha256').update(string).digest('hex');
  return sha256 + '###' + PHONEPE_CONFIG.saltIndex;
}

// Initiate Payment
app.post('/api/phonepe/pay', async (req, res) => {
  try {
    const { 
      merchantTransactionId, 
      amount, 
      merchantUserId, 
      callbackUrl, 
      redirectUrl,
      mobileNumber,
      name,
      email
    } = req.body;

    // Create payload
    const payloadData = {
      merchantId: PHONEPE_CONFIG.merchantId,
      merchantTransactionId: merchantTransactionId,
      merchantUserId: merchantUserId,
      amount: amount * 100, // Convert to paise
      redirectUrl: redirectUrl,
      redirectMode: 'POST',
      callbackUrl: callbackUrl,
      mobileNumber: mobileNumber,
      paymentInstrument: {
        type: 'PAY_PAGE'
      }
    };

    // Encode payload
    const base64Payload = Buffer.from(JSON.stringify(payloadData)).toString('base64');
    
    // Generate checksum
    const checksum = generateChecksum(base64Payload, '/pg/v1/pay');

    // API call to PhonePe
    const response = await axios.post(
      `${PHONEPE_CONFIG.apiUrl}/pg/v1/pay`,
      {
        request: base64Payload
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-VERIFY': checksum
        }
      }
    );

    res.json({
      success: true,
      data: response.data,
      paymentUrl: response.data.data.instrumentResponse.redirectInfo.url
    });

  } catch (error) {
    console.error('PhonePe Pay Error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

// Check Payment Status
app.post('/api/phonepe/status', async (req, res) => {
  try {
    const { merchantTransactionId } = req.body;

    const endpoint = `/pg/v1/status/${PHONEPE_CONFIG.merchantId}/${merchantTransactionId}`;
    const checksum = generateChecksum('', endpoint);

    const response = await axios.get(
      `${PHONEPE_CONFIG.apiUrl}${endpoint}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-VERIFY': checksum,
          'X-MERCHANT-ID': PHONEPE_CONFIG.merchantId
        }
      }
    );

    res.json({
      success: true,
      data: response.data
    });

  } catch (error) {
    console.error('PhonePe Status Error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

// Verify Webhook
app.post('/api/phonepe/webhook', (req, res) => {
  try {
    const xVerify = req.headers['x-verify'];
    const response = req.body.response;

    // Decode base64 response
    const decodedData = Buffer.from(response, 'base64').toString('utf-8');
    const parsedData = JSON.parse(decodedData);

    // Verify checksum
    const expectedChecksum = generateChecksum(response, '');
    const [receivedChecksum] = xVerify.split('###');

    if (receivedChecksum !== expectedChecksum.split('###')[0]) {
      return res.status(401).json({ success: false, message: 'Invalid checksum' });
    }

    // Send to Bubble
    res.json({
      success: true,
      data: parsedData
    });

  } catch (error) {
    console.error('Webhook Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`PhonePe Middleware running on port ${PORT}`);
});
