import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  buildOpenSanctionsQueries,
  opensanctionsConfigured,
  parseOpenSanctionsResponse,
  screenLeadOpenSanctions,
} from "../worker/opensanctions.js";

test("OpenSanctions hanya mengirim nama entitas dan PIC", () => {
  const queries = buildOpenSanctionsQueries({
    name: "PT Contoh Sejahtera",
    contactName: "Budi Santoso",
    phone: "+62 812 3456 7890",
    email: "budi@example.com",
  });
  assert.equal(queries.company.schema, "LegalEntity");
  assert.deepEqual(queries.company.properties.name, ["PT Contoh Sejahtera"]);
  assert.deepEqual(queries.person.properties.name, ["Budi Santoso"]);
  assert.equal(JSON.stringify(queries).includes("budi@example.com"), false);
  assert.equal(JSON.stringify(queries).includes("812"), false);
});

test("OpenSanctions tidak diaktifkan tanpa key atau URL self-host", () => {
  assert.equal(opensanctionsConfigured({}), false);
  assert.equal(
    opensanctionsConfigured({ OPENSANCTIONS_API_KEY: "secret" }),
    true,
  );
  assert.equal(
    opensanctionsConfigured({ OPENSANCTIONS_API_URL: "https://yente.local" }),
    true,
  );
});

test("hasil match kuat menjadi review dengan bukti dan tautan", () => {
  const result = parseOpenSanctionsResponse(
    {
      responses: {
        company: {
          results: [
            {
              id: "NK-test",
              caption: "PT Contoh Sejahtera",
              score: 0.91,
              match: true,
              target: true,
              properties: { topics: ["sanction", "debarment"] },
              datasets: ["us_ofac_sdn"],
            },
          ],
        },
      },
    },
    { threshold: 0.8 },
  );
  assert.equal(result.status, "review");
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].id, "NK-test");
  assert.match(result.evidence[0], /OpenSanctions perusahaan/);
  assert.match(result.evidence[0], /0\.91/);
  assert.match(result.evidence[0], /opensanctions\.org\/entities\/NK-test/);
});

test("kandidat di bawah threshold atau related party diabaikan", () => {
  const result = parseOpenSanctionsResponse(
    {
      responses: {
        person: {
          results: [
            {
              id: "low",
              caption: "Nama Umum",
              score: 0.72,
              match: true,
              target: true,
              properties: { topics: ["role.pep"] },
            },
            {
              id: "related",
              caption: "Nama Terkait",
              score: 0.95,
              match: true,
              target: false,
              properties: { topics: ["sanction"] },
            },
          ],
        },
      },
    },
    { threshold: 0.8 },
  );
  assert.equal(result.status, "clear");
  assert.deepEqual(result.matches, []);
  assert.match(result.evidence[0], /tidak ada kandidat kuat/);
});

test("query yang ditolak API menjadi error, bukan clear", () => {
  const result = parseOpenSanctionsResponse(
    { responses: { person: { status: 400, results: [] } } },
    { threshold: 0.8 },
  );
  assert.equal(result.status, "error");
  assert.match(result.evidence[0], /HTTP 400/);
  assert.match(result.error, /PIC/);
});

test("screening nonaktif tidak melakukan request jaringan", async () => {
  const result = await screenLeadOpenSanctions(
    null,
    { name: "PT Contoh", contactName: "Budi" },
    {},
  );
  assert.equal(result.configured, false);
  assert.equal(result.status, "disabled");
  assert.deepEqual(result.evidence, []);
});

test("screening memanggil /match dengan query dan autentikasi yang benar", async () => {
  let received = null;
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      received = {
        url: request.url,
        auth: request.headers.authorization,
        body: JSON.parse(body),
      };
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          responses: {
            person: {
              results: [
                {
                  id: "NK-local",
                  caption: "Budi Santoso",
                  score: 0.88,
                  match: true,
                  target: true,
                  properties: { topics: ["role.pep"] },
                },
              ],
            },
          },
        }),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    const result = await screenLeadOpenSanctions(
      null,
      { name: "PT Contoh", contactName: "Budi Santoso" },
      {
        OPENSANCTIONS_API_URL: `http://127.0.0.1:${port}`,
        OPENSANCTIONS_API_KEY: "test-key",
      },
    );
    assert.equal(result.status, "review");
    assert.equal(result.matches[0].query, "person");
    assert.match(received.url, /\/match\/default\?/);
    assert.match(received.url, /topics=sanction/);
    assert.match(received.url, /algorithm=logic-v2/);
    assert.equal(received.auth, "ApiKey test-key");
    assert.deepEqual(received.body.queries.person.properties.name, ["Budi Santoso"]);
    assert.equal("phone" in received.body.queries.person.properties, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
