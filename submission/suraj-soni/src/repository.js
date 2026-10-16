// Repository pattern keeps persistence access out of route handlers and tests.
class InMemoryRepository {
  constructor() { this.reset(); }

  reset() {
    this.customers = new Map([
      ["cust_test_001", { id: "cust_test_001", name: "Test Customer" }],
      ["cust_test_002", { id: "cust_test_002", name: "Second Test Customer" }]
    ]);
    this.subscriptions = new Map();
    this.invoices = new Map();
    this.webhookEvents = new Map();
    this.auditEvents = [];
  }

  addSubscription(record) { this.subscriptions.set(record.id, structuredClone(record)); return structuredClone(record); }
  getSubscription(id) { const x = this.subscriptions.get(id); return x ? structuredClone(x) : null; }
  saveSubscription(record) { this.subscriptions.set(record.id, structuredClone(record)); return structuredClone(record); }
  listSubscriptions() { return [...this.subscriptions.values()].map(x => structuredClone(x)); }

  addInvoice(record) {
    if (this.invoices.has(record.id)) return { record: structuredClone(this.invoices.get(record.id)), inserted: false };
    this.invoices.set(record.id, structuredClone(record));
    return { record: structuredClone(record), inserted: true };
  }
  getInvoice(id) { const x = this.invoices.get(id); return x ? structuredClone(x) : null; }
  updateInvoice(record) { this.invoices.set(record.id, structuredClone(record)); return structuredClone(record); }
  listInvoices(subscription_id) {
    return [...this.invoices.values()].filter(x => !subscription_id || x.subscription_id === subscription_id).map(x => structuredClone(x));
  }

  hasWebhookEvent(event_id) { return this.webhookEvents.has(event_id); }
  addWebhookEvent(record) { this.webhookEvents.set(record.event_id, structuredClone(record)); }
  listWebhookEvents(subscription_id) {
    return [...this.webhookEvents.values()].filter(x => !subscription_id || x.subscription_id === subscription_id).map(x => structuredClone(x));
  }
  addAudit(record) { this.auditEvents.push(structuredClone(record)); }
  listAudit(subscription_id) {
    return this.auditEvents.filter(x => !subscription_id || x.subscription_id === subscription_id).map(x => structuredClone(x));
  }
}

module.exports = { InMemoryRepository };