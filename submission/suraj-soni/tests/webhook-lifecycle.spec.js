const { test, expect } = require("@playwright/test");
const { BillingApiClient } = require("./support/api-client");
const { SubscriptionBuilder, WebhookBuilder, signWebhook } = require("../src/builders");
const { PersistenceVerifier } = require("./support/verifiers");

test.describe("Webhook lifecycle, idempotency, and persistence", () => {
  let api, verify;
  test.beforeEach(async ({ request }) => {
    api = new BillingApiClient(request);
    await api.reset();
    verify = new PersistenceVerifier(api);
  });

  async function createBasic() {
    const response = await api.createSubscription(new SubscriptionBuilder().withPlan("basic").build());
    expect(response.status()).toBe(201);
    return (await response.json()).subscription;
  }

  async function send(payload, signatureOverride) {
    const raw = JSON.stringify(payload);
    const signature = signatureOverride === undefined ? signWebhook(raw) : signatureOverride;
    return api.postWebhook(payload, signature);
  }

  test("trialing -> active on successful first payment; persists invoice, event, and audit", async () => {
    const sub = await createBasic();
    const event = new WebhookBuilder().forSubscription(sub.id).withType("payment.succeeded").withAmount(1900).build();
    expect((await send(event)).status()).toBe(200);
    expect((await verify.subscription(sub.id)).status).toBe("active");
    expect((await verify.invoices(sub.id)).map(x => x.status)).toContain("paid");
    expect((await verify.webhookEvents(sub.id))).toHaveLength(1);
    expect((await verify.auditEvents(sub.id)).map(x => x.to_status)).toContain("active");
    await verify.assertActiveHasSuccessfulPayment(sub.id);
  });

  test("trialing -> past_due on failed first payment", async () => {
    const sub = await createBasic();
    const event = new WebhookBuilder().forSubscription(sub.id).withType("payment.failed").build();
    await send(event);
    expect((await verify.subscription(sub.id)).status).toBe("past_due");
    expect((await verify.invoices(sub.id))[0].status).toBe("failed");
  });

  test("active -> past_due on recurring failure", async () => {
    const sub = await createBasic();
    await send(new WebhookBuilder().forSubscription(sub.id).withType("payment.succeeded").build());
    const fail = new WebhookBuilder().forSubscription(sub.id).withType("payment.failed").forInvoice("inv_recurring_1").build();
    await send(fail);
    expect((await verify.subscription(sub.id)).status).toBe("past_due");
  });

  test("past_due -> active on retry success", async () => {
    const sub = await createBasic();
    await send(new WebhookBuilder().forSubscription(sub.id).withType("payment.failed").build());
    const success = new WebhookBuilder().forSubscription(sub.id).withType("payment.succeeded").forInvoice("inv_retry_success").build();
    await send(success);
    expect((await verify.subscription(sub.id)).status).toBe("active");
    await verify.assertActiveHasSuccessfulPayment(sub.id);
  });

  test("past_due -> canceled when retries are exhausted", async () => {
    const sub = await createBasic();
    await send(new WebhookBuilder().forSubscription(sub.id).withType("payment.failed").build());
    const exhausted = new WebhookBuilder().forSubscription(sub.id).withType("payment.failed").forInvoice("inv_final_failure").withRetriesExhausted().build();
    await send(exhausted);
    expect((await verify.subscription(sub.id)).status).toBe("canceled");
  });

  test("trialing -> canceled via API", async () => {
    const sub = await createBasic();
    expect((await api.cancelSubscription(sub.id)).status()).toBe(200);
    expect((await verify.subscription(sub.id)).status).toBe("canceled");
  });

  test("active -> canceled via API", async () => {
    const sub = await createBasic();
    await send(new WebhookBuilder().forSubscription(sub.id).withType("payment.succeeded").build());
    expect((await api.cancelSubscription(sub.id)).status()).toBe(200);
    expect((await verify.subscription(sub.id)).status).toBe("canceled");
  });

  test("duplicate event_id is idempotent and does not duplicate invoice or transition", async () => {
    const sub = await createBasic();
    const event = new WebhookBuilder().forSubscription(sub.id).withEventId("evt_duplicate_fixed").withType("payment.succeeded").forInvoice("inv_duplicate_fixed").build();
    const first = await send(event);
    const second = await send(event);
    expect((await first.json()).duplicate).toBe(false);
    expect((await second.json()).duplicate).toBe(true);
    expect(await verify.invoices(sub.id)).toHaveLength(1);
    expect(await verify.webhookEvents(sub.id)).toHaveLength(1);
    expect((await verify.auditEvents(sub.id)).filter(x => x.to_status === "active")).toHaveLength(1);
    expect((await (await api.providerCalls()).json()).calls).toHaveLength(0);
  });

  test("canceled subscription cannot be reactivated by a later success webhook", async () => {
    const sub = await createBasic();
    await api.cancelSubscription(sub.id);
    const result = await send(new WebhookBuilder().forSubscription(sub.id).withType("payment.succeeded").build());
    expect(result.status()).toBe(200);
    expect((await verify.subscription(sub.id)).status).toBe("canceled");
    expect((await verify.webhookEvents(sub.id))[0].outcome).toBe("ignored_canceled_subscription");
  });

  test("late failure for an already-paid invoice does not regress active subscription", async () => {
    const sub = await createBasic();
    const success = new WebhookBuilder().forSubscription(sub.id).withType("payment.succeeded").forInvoice("inv_same_invoice").build();
    await send(success);
    const failure = new WebhookBuilder().forSubscription(sub.id).withType("payment.failed").forInvoice("inv_same_invoice").build();
    await send(failure);
    expect((await verify.subscription(sub.id)).status).toBe("active");
    expect((await verify.invoices(sub.id))).toHaveLength(1);
    expect((await verify.invoices(sub.id))[0].status).toBe("paid");
    expect((await verify.webhookEvents(sub.id)).some(x => x.outcome === "ignored_stale_failure")).toBeTruthy();
  });

  test("rejects missing/forged signatures and malformed JSON without persistence", async ({ request }) => {
    const sub = await createBasic();
    const event = new WebhookBuilder().forSubscription(sub.id).build();
    expect((await api.postWebhook(event)).status()).toBe(401);
    expect((await send(event, "bad-signature")).status()).toBe(401);

    const raw = "{not-json";
    const response = await request.post("/webhooks/payment-provider", {
      // Send bytes verbatim so the signature covers the exact raw HTTP body.
      data: Buffer.from(raw, "utf8"),
      headers: { "Content-Type": "application/json", "X-Provider-Signature": signWebhook(raw) }
    });
    expect(response.status()).toBe(400);
    expect(await verify.webhookEvents(sub.id)).toHaveLength(0);
    expect((await verify.subscription(sub.id)).status).toBe("trialing");
  });

  test("valid signature but missing required event fields is rejected", async () => {
    const rawPayload = { type: "payment.succeeded" };
    expect((await send(rawPayload)).status()).toBe(400);
    expect((await (await api.webhookEvents()).json()).events).toHaveLength(0);
  });

  test("refund is recorded against a paid invoice without changing subscription status", async () => {
    const sub = await createBasic();
    await send(new WebhookBuilder().forSubscription(sub.id).withType("payment.succeeded").forInvoice("inv_refund").build());
    const refund = new WebhookBuilder().forSubscription(sub.id).withType("payment.refunded").forInvoice("inv_refund").build();
    await send(refund);
    expect((await verify.subscription(sub.id)).status).toBe("active");
    expect((await verify.invoices(sub.id))[0].status).toBe("refunded");
  });

  test("plan price is used when webhook amount is omitted", async () => {
    const sub = await createBasic();
    const event = new WebhookBuilder().forSubscription(sub.id).withType("payment.succeeded").build();
    delete event.amount;
    await send(event);
    expect((await verify.invoices(sub.id))[0].amount).toBe(1900);
  });
});
