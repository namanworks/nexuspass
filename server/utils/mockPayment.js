const { v4: uuidv4 } = require('uuid');

/**
 * Simulates a payment processor.
 * Always succeeds in mock mode.
 * Replace with Razorpay SDK calls for production payment processing.
 */
async function simulatePayment(amount, userId) {
  return {
    success: true,
    transactionRef: uuidv4(),
    amount,
    userId,
    timestamp: new Date().toISOString(),
  };
}

module.exports = { simulatePayment };
