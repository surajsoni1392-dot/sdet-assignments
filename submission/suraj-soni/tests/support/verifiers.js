const { expect } = require("@playwright/test");

class PersistenceVerifier {
  constructor(api) { this.api = api; }

  async subscription(id) {
    const response = await this.api.getSubscription(id);
    expect(response.status()).toBe(200);
    return (await response.json()).subscription;
  }

  async invoices(subscriptionId) {
    const response = await this.api.invoices(subscriptionId);
    expect(response.ok()).toBeTruthy();
    return (await response.json()).invoices;
  }

  async webhookEvents(subscriptionId) {
    const response = await this.api.webhookEvents(subscriptionId);
    expect(response.ok()).toBeTruthy();
    return (await response.json()).events;
  }

  async auditEvents(subscriptionId) {
    const response = await this.api.auditEvents(subscriptionId);
    expect(response.ok()).toBeTruthy();
    return (await response.json()).events;
  }

  async assertActiveHasSuccessfulPayment(subscriptionId) {
    const subscription = await this.subscription(subscriptionId);
    if (subscription.status === "active") {
      const invoices = await this.invoices(subscriptionId);
      expect(invoices.some(x => x.status === "paid")).toBeTruthy();
    }
  }
}

module.exports = { PersistenceVerifier };