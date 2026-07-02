const { v4: uuidv4 } = require("uuid");

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
