// Adapter seam: production code can implement the same charge() contract.
// This deterministic fake never calls a real payment network.
class MockPaymentProvider {
  constructor() {
    this.outcome = "success";
    this.calls = [];
  }
  configure(outcome) { this.outcome = outcome; }
  reset() { this.outcome = "success"; this.calls = []; }
  async charge({ customerId, paymentMethodId, amount, currency, idempotencyKey }) {
    const call = { customerId, paymentMethodId, amount, currency, idempotencyKey };
    this.calls.push(structuredClone(call));
    if (this.outcome === "timeout") {
      const error = new Error("Payment provider timed out");
      error.code = "PROVIDER_TIMEOUT";
      throw error;
    }
    return {
      status: this.outcome === "decline" ? "declined" : "succeeded",
      provider_reference: `pay_${idempotencyKey}`,
      amount,
      currency
    };
  }
}

module.exports = { MockPaymentProvider };