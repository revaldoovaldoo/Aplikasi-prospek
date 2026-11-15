import assert from "node:assert/strict";
import test from "node:test";
import { readTelegramOutboxHealth } from "../worker/robot.js";

test("readTelegramOutboxHealth memetakan status dan menghitung pesan yang aman dikirim ulang", async () => {
  const db = {
    prepare() {
      return {
        async all() {
          return {
            results: [
              { status: "pending", review_reason: "", total: 2 },
              { status: "sent", review_reason: "", total: 5 },
              { status: "failed", review_reason: "", total: 1 },
              { status: "uncertain", review_reason: "uncertain", total: 1 },
              { status: "needs_review", review_reason: "uncertain", total: 1 },
              { status: "needs_review", review_reason: "failed", total: 1 },
            ],
          };
        },
      };
    },
  };

  const health = await readTelegramOutboxHealth(db);
  assert.equal(health.pending, 2);
  assert.equal(health.sent, 5);
  assert.equal(health.failed, 1);
  assert.equal(health.uncertain, 1);
  assert.equal(health.needsReview, 2);
  assert.equal(health.retryable, 2);
  assert.equal(health.total, 11);
  assert.equal(health.attention, 4);
});
