class BillingApiClient {
  constructor(request) { this.request = request; }

  createSubscription(body) {
    return this.request.post("/subscriptions", { data: body });
  }
  getSubscription(id) { return this.request.get(`/subscriptions/${id}`); }
  cancelSubscription(id) { return this.request.post(`/subscriptions/${id}/cancel`); }

  async postWebhook(payload, signature) {
    const rawBody = JSON.stringify(payload);
    return this.request.post("/webhooks/payment-provider", {
      data: rawBody,
      headers: {
        "Content-Type": "application/json",
        ...(signature ? { "X-Provider-Signature": signature } : {})
      }
    });
  }

  reset() { return this.request.post("/__test/reset"); }
  configureProvider(outcome) { return this.request.post("/__test/provider/outcome", { data: { outcome } }); }
  providerCalls() { return this.request.get("/__test/provider/calls"); }
  subscriptions() { return this.request.get("/__test/db/subscriptions"); }
  invoices(subscription_id) { return this.request.get("/__test/db/invoices", { params: subscription_id ? { subscription_id } : {} }); }
  webhookEvents(subscription_id) { return this.request.get("/__test/db/webhook-events", { params: subscription_id ? { subscription_id } : {} }); }
  auditEvents(subscription_id) { return this.request.get("/__test/db/audit", { params: subscription_id ? { subscription_id } : {} }); }
}

module.exports = { BillingApiClient };