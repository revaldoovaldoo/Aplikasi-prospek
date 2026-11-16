import assert from "node:assert/strict";
import test from "node:test";
import {
  draftWhatsAppReply,
  emptyRequirements,
} from "../worker/whatsapp-agent.js";

const lead = {
  id: "osm:node/1",
  companyName: "Hotel Contoh",
  contactName: "Budi Santoso",
  category: "hotel",
};

test("agen draft menyapa PIC dan mulai menggali kebutuhan", () => {
  const result = draftWhatsAppReply({
    text: "Halo",
    lead,
    state: "new",
    requirements: emptyRequirements(),
  });
  assert.equal(result.state, "discovery");
  assert.match(result.reply, /asisten digital ASNET/);
  assert.match(result.reply, /internet/);
  assert.equal(result.handoff, null);
  assert.equal(result.draftOnly, true);
});

test("agen draft mencatat internet dan kuota lalu menanyakan perangkat", () => {
  const result = draftWhatsAppReply({
    text: "Kami butuh internet 100 Mbps untuk hotel",
    lead,
    state: "discovery",
    requirements: emptyRequirements(),
  });
  assert.equal(result.requirements.internet, true);
  assert.equal(result.requirements.quota, "100 Mbps");
  assert.match(result.reply, /perangkat/);
});

test("agen draft mengenali kebutuhan Data Center dan server", () => {
  const result = draftWhatsAppReply({
    text: "Kami juga butuh data center dan server",
    lead,
    state: "discovery",
    requirements: { ...emptyRequirements(), internet: true, quota: "100 Mbps" },
  });
  assert.equal(result.requirements.dataCenter, true);
  assert.equal(result.requirements.server, true);
  assert.equal(result.state, "summary");
  assert.match(result.reply, /Ringkasan kebutuhan/);
});

test("agen draft tidak menyebut harga dan langsung handoff", () => {
  const result = draftWhatsAppReply({
    text: "Berapa harga dan diskonnya?",
    lead,
    state: "discovery",
    requirements: { ...emptyRequirements(), internet: true },
  });
  assert.equal(result.state, "handoff");
  assert.equal(result.handoff.reason, "price_or_contract");
  assert.match(result.reply, /nomor WhatsApp pribadi/);
  assert.doesNotMatch(result.reply, /Rp|rupiah|diskon \d/i);
});

test("konfirmasi ringkasan membuat handoff ke WhatsApp pribadi", () => {
  const result = draftWhatsAppReply({
    text: "Ya, setuju",
    lead,
    state: "summary",
    requirements: {
      ...emptyRequirements(),
      internet: true,
      quota: "100 Mbps",
      server: true,
    },
  });
  assert.equal(result.state, "handoff");
  assert.equal(result.handoff.reason, "confirmed_summary");
  assert.match(result.handoff.summary, /internet/);
  assert.match(result.reply, /nomor WhatsApp pribadi/);
});

test("permintaan berhenti menutup percakapan dan tidak mengirim lanjutan", () => {
  const result = draftWhatsAppReply({
    text: "Tolong berhenti menghubungi saya",
    lead,
    state: "discovery",
    requirements: emptyRequirements(),
  });
  assert.equal(result.state, "closed");
  assert.match(result.reply, /tidak akan mengirim pesan lanjutan/);
  assert.equal(result.handoff, null);
});
