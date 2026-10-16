const { test, expect } = require("@playwright/test");
const { BillingApiClient } = require("./support/api-client");
const { SubscriptionBuilder } = require("../src/builders");
const { PersistenceVerifier } = require("./support/verifiers");

test.describe("Subscription API and payment-provider adapter", () => {
  let api, verify;
  test.beforeEach(async ({ request }) => {
    api = new BillingApiClient(request);
    await api.reset();
    verify = new PersistenceVerifier(api);
  });

  test("creates a basic subscription in trialing state and persists it", async () => {
    const body = new SubscriptionBuilder().withPlan("basic").build();
    const response = await api.createSubscription(body);
    expect(response.status()).toBe(201);
    const { subscription } = await response.json();
    expect(subscription).toMatchObject({ customer_id: body.customer_id, plan: "basic", status: "trialing" });
    expect(subscription.trial_ends_at).toBeTruthy();

    const persisted = await verify.subscription(subscription.id);
    expect(persisted.status).toBe("trialing");
    expect(await verify.invoices(subscription.id)).toHaveLength(0);
    expect((await (await api.providerCalls()).json()).calls).toHaveLength(0);
  });

  test("pro plan charges exact configured amount once and persists paid invoice", async () => {
    const body = new SubscriptionBuilder().withPlan("pro").build();
    const response = await api.createSubscription(body);
    expect(response.status()).toBe(201);
    const { subscription, invoice } = await response.json();
    expect(subscription.status).toBe("active");
    expect(invoice).toMatchObject({ amount: 4900, currency: "USD", status: "paid" });
    const calls = (await (await api.providerCalls()).json()).calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      customerId: body.customer_id, paymentMethodId: body.payment_method_id,
      amount: 4900, currency: "USD", idempotencyKey: `initial:${subscription.id}`
    });
    await verify.assertActiveHasSuccessfulPayment(subscription.id);
  });

  test("rejects unknown plan, missing fields, and unknown customer without charge or subscription", async () => {
    expect((await api.createSubscription({ customer_id: "cust_test_001", plan: "gold", payment_method_id: "pm_x" })).status()).toBe(400);
    expect((await api.createSubscription({ customer_id: "cust_test_001", plan: "basic" })).status()).toBe(400);
    expect((await api.createSubscription({ customer_id: "missing", plan: "basic", payment_method_id: "pm_x" })).status()).toBe(404);
    expect((await (await api.subscriptions()).json()).subscriptions).toHaveLength(0);
    expect((await (await api.providerCalls()).json()).calls).toHaveLength(0);
  });

  test("provider decline results in past_due and a failed invoice", async () => {
    await api.configureProvider("decline");
    const response = await api.createSubscription(new SubscriptionBuilder().withPlan("pro").build());
    expect(response.status()).toBe(201);
    const { subscription, invoice } = await response.json();
    expect(subscription.status).toBe("past_due");
    expect(invoice.status).toBe("failed");
    expect(await verify.invoices(subscription.id)).toHaveLength(1);
    expect((await (await api.providerCalls()).json()).calls).toHaveLength(1);
  });

  test("provider timeout is recorded as unknown, never falsely marked paid", async () => {
    await api.configureProvider("timeout");
    const response = await api.createSubscription(new SubscriptionBuilder().withPlan("pro").build());
    expect(response.status()).toBe(201);
    const { subscription, invoice } = await response.json();
    expect(subscription.status).toBe("past_due");
    expect(invoice.status).toBe("unknown");
    expect((await verify.invoices(subscription.id)).some(x => x.status === "paid")).toBeFalsy();
    expect((await (await api.providerCalls()).json()).calls).toHaveLength(1);
  });

  test("retrieves and cancels a subscription; repeat cancellation is rejected", async () => {
    const create = await api.createSubscription(new SubscriptionBuilder().build());
    const { subscription } = await create.json();
    expect((await api.getSubscription(subscription.id)).status()).toBe(200);
    const cancel = await api.cancelSubscription(subscription.id);
    expect(cancel.status()).toBe(200);
    expect((await cancel.json()).subscription.status).toBe("canceled");
    expect((await api.cancelSubscription(subscription.id)).status()).toBe(409);
  });

  test("unknown subscription returns 404", async () => {
    expect((await api.getSubscription("sub_missing")).status()).toBe(404);
    expect((await api.cancelSubscription("sub_missing")).status()).toBe(404);
  });
});