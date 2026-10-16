const crypto = require("node:crypto");

class SubscriptionBuilder {
  constructor() {
    this.data = {
      customer_id: "cust_test_001",
      plan: "basic",
      payment_method_id: "pm_test_visa_4242"
    };
  }
  withCustomer(customer_id) { this.data.customer_id = customer_id; return this; }
  withPlan(plan) { this.data.plan = plan; return this; }
  withPaymentMethod(payment_method_id) { this.data.payment_method_id = payment_method_id; return this; }
  build() { return { ...this.data }; }
}

class WebhookBuilder {
  constructor() {
    this.data = {
      event_id: `evt_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
      type: "payment.succeeded",
      subscription_id: "sub_replace_me",
      invoice_id: `inv_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
      amount: 1900,
      currency: "USD"
    };
  }
  withEventId(event_id) { this.data.event_id = event_id; return this; }
  withType(type) { this.data.type = type; return this; }
  forSubscription(subscription_id) { this.data.subscription_id = subscription_id; return this; }
  forInvoice(invoice_id) { this.data.invoice_id = invoice_id; return this; }
  withAmount(amount) { this.data.amount = amount; return this; }
  withCurrency(currency) { this.data.currency = currency; return this; }
  withRetriesExhausted(value = true) { this.data.retries_exhausted = value; return this; }
  build() { return { ...this.data }; }
}

function signWebhook(rawBody, secret = "local-test-secret") {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

module.exports = { SubscriptionBuilder, WebhookBuilder, signWebhook };