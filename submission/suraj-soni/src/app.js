const express = require("express");
const crypto = require("node:crypto");
const { PLANS, makeId, transition, InvalidTransitionError } = require("./domain");
const { InMemoryRepository } = require("./repository");
const { MockPaymentProvider } = require("./payment-provider");

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "local-test-secret";

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function createApp({ repo = new InMemoryRepository(), provider = new MockPaymentProvider(), webhookSecret = WEBHOOK_SECRET } = {}) {
  const app = express();

  // Preserve exact raw bytes for HMAC verification.
  app.use("/webhooks/payment-provider", express.raw({ type: "application/json", limit: "64kb" }));
  app.use((req, res, next) => {
    if (req.path === "/webhooks/payment-provider" && Buffer.isBuffer(req.body)) return next();
    return express.json({ limit: "64kb" })(req, res, next);
  });

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.post("/subscriptions", async (req, res) => {
    const { customer_id, plan, payment_method_id } = req.body || {};
    if (!customer_id || !plan || !payment_method_id) {
      return res.status(400).json({ error: "customer_id, plan, and payment_method_id are required" });
    }
    if (!repo.customers.has(customer_id)) return res.status(404).json({ error: "Unknown customer" });
    const planConfig = PLANS[plan];
    if (!planConfig) return res.status(400).json({ error: "Unknown plan" });

    const now = new Date().toISOString();
    const subscription = {
      id: makeId("sub"), customer_id, plan, payment_method_id,
      // Model the first charge as a transition from trialing, even for a plan
      // with no trial, so the audit trail uses the same lifecycle rules.
      status: "trialing",
      trial_ends_at: planConfig.trialDays ? new Date(Date.now() + planConfig.trialDays * 86400000).toISOString() : null,
      created_at: now, updated_at: now
    };
    repo.addSubscription(subscription);
    repo.addAudit({ id: makeId("aud"), subscription_id: subscription.id, from_status: null, to_status: "trialing", reason: "subscription.created", created_at: now });

    if (!planConfig.chargeImmediately) return res.status(201).json({ subscription: repo.getSubscription(subscription.id) });

    const invoiceId = makeId("inv");
    const idempotencyKey = `initial:${subscription.id}`;
    try {
      const result = await provider.charge({
        customerId: customer_id, paymentMethodId: payment_method_id,
        amount: planConfig.amount, currency: planConfig.currency, idempotencyKey
      });
      const invoice = {
        id: invoiceId, subscription_id: subscription.id, amount: planConfig.amount,
        currency: planConfig.currency, status: result.status === "succeeded" ? "paid" : "failed",
        provider_reference: result.provider_reference, idempotency_key: idempotencyKey,
        created_at: new Date().toISOString()
      };
      repo.addInvoice(invoice);
      if (result.status === "succeeded") {
        transition(subscription, "active");
        repo.addAudit({ id: makeId("aud"), subscription_id: subscription.id, from_status: "trialing", to_status: "active", reason: "initial_payment.succeeded", created_at: new Date().toISOString() });
      } else {
        transition(subscription, "past_due");
        repo.addAudit({ id: makeId("aud"), subscription_id: subscription.id, from_status: "trialing", to_status: "past_due", reason: "initial_payment.failed", created_at: new Date().toISOString() });
      }
      repo.saveSubscription(subscription);
      return res.status(201).json({ subscription: repo.getSubscription(subscription.id), invoice: repo.getInvoice(invoiceId) });
    } catch (error) {
      // A timeout is ambiguous: record an attempt, do not claim success.
      const invoice = { id: invoiceId, subscription_id: subscription.id, amount: planConfig.amount, currency: planConfig.currency, status: "unknown", provider_reference: null, idempotency_key: idempotencyKey, error_code: error.code || "PROVIDER_ERROR", created_at: new Date().toISOString() };
      repo.addInvoice(invoice);
      transition(subscription, "past_due");
      repo.saveSubscription(subscription);
      repo.addAudit({ id: makeId("aud"), subscription_id: subscription.id, from_status: "trialing", to_status: "past_due", reason: "initial_payment.timeout", created_at: new Date().toISOString() });
      return res.status(201).json({ subscription: repo.getSubscription(subscription.id), invoice: repo.getInvoice(invoiceId) });
    }
  });

  app.get("/subscriptions/:id", (req, res) => {
    const subscription = repo.getSubscription(req.params.id);
    if (!subscription) return res.status(404).json({ error: "Subscription not found" });
    return res.json({ subscription });
  });

  app.post("/subscriptions/:id/cancel", (req, res) => {
    const subscription = repo.getSubscription(req.params.id);
    if (!subscription) return res.status(404).json({ error: "Subscription not found" });
    if (subscription.status === "canceled") return res.status(409).json({ error: "Subscription already canceled" });
    const previous = subscription.status;
    try { transition(subscription, "canceled"); }
    catch (error) { return res.status(409).json({ error: error.message }); }
    repo.saveSubscription(subscription);
    repo.addAudit({ id: makeId("aud"), subscription_id: subscription.id, from_status: previous, to_status: "canceled", reason: "subscription.canceled_by_api", created_at: new Date().toISOString() });
    return res.json({ subscription });
  });

  app.post("/webhooks/payment-provider", (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const signature = req.get("X-Provider-Signature");
    const expected = crypto.createHmac("sha256", webhookSecret).update(raw).digest("hex");
    if (!safeEqual(signature, expected)) return res.status(401).json({ error: "Invalid webhook signature" });

    let event;
    try { event = JSON.parse(raw.toString("utf8")); }
    catch { return res.status(400).json({ error: "Malformed JSON payload" }); }

    if (!event || typeof event.event_id !== "string" || typeof event.type !== "string" ||
        typeof event.subscription_id !== "string" || typeof event.invoice_id !== "string") {
      return res.status(400).json({ error: "event_id, type, subscription_id, and invoice_id are required" });
    }
    if (!["payment.succeeded", "payment.failed", "payment.refunded"].includes(event.type)) {
      return res.status(400).json({ error: "Unsupported event type" });
    }
    if (repo.hasWebhookEvent(event.event_id)) return res.status(200).json({ received: true, duplicate: true });

    const subscription = repo.getSubscription(event.subscription_id);
    if (!subscription) return res.status(404).json({ error: "Subscription not found" });

    // Persist every authenticated event, including stale/out-of-order events, for auditability.
    const eventRecord = { ...event, processed_at: new Date().toISOString(), outcome: "ignored" };
    const invoiceBefore = repo.getInvoice(event.invoice_id);
    const planConfig = PLANS[subscription.plan];

    // A provider invoice ID is globally unique in this fixture. Never let an
    // event for one subscription mutate another subscription's invoice.
    if (invoiceBefore && invoiceBefore.subscription_id !== subscription.id) {
      eventRecord.outcome = "ignored_invoice_subscription_mismatch";
      repo.addWebhookEvent(eventRecord);
      return res.status(200).json({ received: true, duplicate: false, outcome: eventRecord.outcome });
    }

    try {
      if (subscription.status === "canceled") {
        eventRecord.outcome = "ignored_canceled_subscription";
      } else if (invoiceBefore?.status === "refunded" && event.type !== "payment.refunded") {
        eventRecord.outcome = "ignored_refunded_invoice";
      } else if (event.type === "payment.succeeded") {
        const successfulInvoice = {
          id: event.invoice_id, subscription_id: subscription.id,
          amount: Number.isInteger(event.amount) ? event.amount : planConfig.amount,
          currency: event.currency || planConfig.currency, status: "paid",
          provider_reference: event.provider_reference || null,
          idempotency_key: `webhook:${event.event_id}`, created_at: new Date().toISOString()
        };
        // A retry can succeed against the same invoice after an earlier
        // failure. Update that invoice in place; never create a second row.
        const invoiceResult = invoiceBefore
          ? { record: invoiceBefore, inserted: false }
          : repo.addInvoice(successfulInvoice);
        if (invoiceBefore && invoiceBefore.status !== "paid" && invoiceBefore.status !== "refunded") {
          repo.updateInvoice({ ...invoiceBefore, ...successfulInvoice, created_at: invoiceBefore.created_at });
        }
        if (subscription.status === "past_due" || subscription.status === "trialing") {
          const previous = subscription.status;
          transition(subscription, "active");
          repo.saveSubscription(subscription);
          repo.addAudit({ id: makeId("aud"), subscription_id: subscription.id, from_status: previous, to_status: "active", reason: event.type, created_at: new Date().toISOString() });
        } else if (subscription.status === "active") {
          eventRecord.outcome = invoiceResult.inserted ? "invoice_recorded_no_transition" : "ignored_duplicate_invoice";
        }
        if (!invoiceResult.inserted && !invoiceBefore) eventRecord.outcome = "invoice_already_exists";
      } else if (event.type === "payment.failed") {
        const existingInvoice = invoiceBefore;
        // Do not let a late failure regress an invoice that is already paid.
        if (existingInvoice?.status === "paid") {
          eventRecord.outcome = "ignored_stale_failure";
        } else {
          repo.addInvoice({
            id: event.invoice_id, subscription_id: subscription.id,
            amount: Number.isInteger(event.amount) ? event.amount : planConfig.amount,
            currency: event.currency || planConfig.currency, status: "failed",
            provider_reference: event.provider_reference || null,
            idempotency_key: `webhook:${event.event_id}`, created_at: new Date().toISOString()
          });
          const target = event.retries_exhausted ? "canceled" : "past_due";
          if (subscription.status !== target) {
            const previous = subscription.status;
            transition(subscription, target);
            repo.saveSubscription(subscription);
            repo.addAudit({ id: makeId("aud"), subscription_id: subscription.id, from_status: previous, to_status: target, reason: event.type, created_at: new Date().toISOString() });
          }
          eventRecord.outcome = "failure_recorded";
        }
      } else if (event.type === "payment.refunded") {
        if (invoiceBefore?.status === "paid") {
          repo.updateInvoice({ ...invoiceBefore, status: "refunded" });
          eventRecord.outcome = "refund_recorded";
        } else {
          eventRecord.outcome = "ignored_refund_without_paid_invoice";
        }
      }
    } catch (error) {
      if (!(error instanceof InvalidTransitionError)) throw error;
      eventRecord.outcome = "ignored_invalid_transition";
    }

    repo.addWebhookEvent(eventRecord);
    return res.status(200).json({ received: true, duplicate: false, outcome: eventRecord.outcome });
  });

  // Test-only observability/control endpoints. Never expose these in a production deployment.
  app.post("/__test/reset", (_req, res) => {
    repo.reset(); provider.reset();
    res.json({ reset: true });
  });
  app.post("/__test/provider/outcome", (req, res) => {
    const outcome = req.body?.outcome;
    if (!["success", "decline", "timeout"].includes(outcome)) return res.status(400).json({ error: "outcome must be success, decline, or timeout" });
    provider.configure(outcome);
    res.json({ outcome });
  });
  app.get("/__test/provider/calls", (_req, res) => res.json({ calls: provider.calls }));
  app.get("/__test/db/subscriptions", (_req, res) => res.json({ subscriptions: repo.listSubscriptions() }));
  app.get("/__test/db/invoices", (req, res) => res.json({ invoices: repo.listInvoices(req.query.subscription_id) }));
  app.get("/__test/db/webhook-events", (req, res) => res.json({ events: repo.listWebhookEvents(req.query.subscription_id) }));
  app.get("/__test/db/audit", (req, res) => res.json({ events: repo.listAudit(req.query.subscription_id) }));

  app.use((err, _req, res, _next) => {
    // Express JSON parser errors should be surfaced as client errors.
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Malformed JSON payload" });
    return res.status(500).json({ error: "Internal server error" });
  });

  return { app, repo, provider };
}

module.exports = { createApp, WEBHOOK_SECRET };
