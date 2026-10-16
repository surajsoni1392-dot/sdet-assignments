const crypto = require("node:crypto");

// State pattern represented as an explicit transition table: all status changes pass here.
const TRANSITIONS = Object.freeze({
  trialing: new Set(["active", "past_due", "canceled"]),
  active: new Set(["past_due", "canceled"]),
  past_due: new Set(["active", "canceled"]),
  canceled: new Set()
});

class InvalidTransitionError extends Error {
  constructor(from, to) {
    super(`Invalid subscription transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
    this.from = from;
    this.to = to;
  }
}

function transition(subscription, nextStatus) {
  if (subscription.status === nextStatus) return false;
  if (!TRANSITIONS[subscription.status]?.has(nextStatus)) {
    throw new InvalidTransitionError(subscription.status, nextStatus);
  }
  subscription.status = nextStatus;
  subscription.updated_at = new Date().toISOString();
  return true;
}

const PLANS = Object.freeze({
  basic: { name: "basic", amount: 1900, currency: "USD", trialDays: 7, chargeImmediately: false },
  pro: { name: "pro", amount: 4900, currency: "USD", trialDays: 0, chargeImmediately: true }
});

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

module.exports = { TRANSITIONS, InvalidTransitionError, transition, PLANS, makeId };