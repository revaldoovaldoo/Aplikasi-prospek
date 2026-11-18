import assert from "node:assert/strict";
import test from "node:test";

import { robotDueWorkCounts } from "../worker/robot.js";

function fakeCountDb({ jobs = 0, outbox = 0, screening = 0, cooldownUntil = "", fail = false } = {}) {
  return {
    prepare(sql) {
      const query = sql.replace(/\s+/g, " ");
      const statement = {
        bind: () => statement,
        run: async () => ({ meta: { changes: 0 } }),
        all: async () => ({ results: [] }),
        first: async () => {
          if (fail) throw new Error("d1 tidak tersedia");
          if (query.includes("FROM corporate_robot_jobs")) return { total: jobs };
          if (query.includes("FROM corporate_telegram_outbox")) return { total: outbox };
          if (query.includes("FROM corporate_leads")) return { total: screening };
          if (query.includes("FROM corporate_meta")) {
            return cooldownUntil
              ? { value: JSON.stringify({ until: cooldownUntil }) }
              : null;
          }
          return null;
        },
      };
      return statement;
    },
  };
}

test("tick robot tanpa antrean melaporkan nol pekerjaan", async () => {
  const due = await robotDueWorkCounts(fakeCountDb(), {});
  assert.deepEqual(due, { jobs: 0, outbox: 0, screening: 0 });
});

test("antrean job dan outbox yang jatuh tempo terhitung", async () => {
  const due = await robotDueWorkCounts(fakeCountDb({ jobs: 3, outbox: 2 }), {});
  assert.equal(due.jobs, 3);
  assert.equal(due.outbox, 2);
});

test("screening dihitung hanya bila OpenSanctions siap dan tidak cooldown", async () => {
  const env = { OPENSANCTIONS_API_KEY: "test-key" };
  const ready = await robotDueWorkCounts(fakeCountDb({ screening: 5 }), env);
  assert.equal(ready.screening, 5);

  const blocked = await robotDueWorkCounts(
    fakeCountDb({
      screening: 5,
      cooldownUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }),
    env,
  );
  assert.equal(blocked.screening, 0);

  const unconfigured = await robotDueWorkCounts(fakeCountDb({ screening: 5 }), {});
  assert.equal(unconfigured.screening, 0);
});

test("gagal membaca antrean membuat robot tetap berjalan", async () => {
  const due = await robotDueWorkCounts(fakeCountDb({ fail: true }), {});
  assert.equal(due.jobs, 1);
});
