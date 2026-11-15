import type { Company, Database, StoredFile } from "../types";
import type {
  CorporateData,
  CorporateLead,
  CorporatePerson,
  CorporateRefreshResult,
  CorporateRobotRunResult,
  CorporateRobotStatus,
} from "./corporate";

export const MAX_PDF_BYTES = 15 * 1024 * 1024;

export interface SessionUser {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

export interface StateSnapshot {
  data: Database | null;
  revision: number;
  updatedAt: string | null;
}

export type SaveResult =
  | { conflict: false; revision: number; updatedAt: string }
  | {
      conflict: true;
      revision: number;
      data: Database | null;
      updatedAt: string | null;
    };

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function fetchSession(): Promise<SessionUser | null> {
  const response = await fetch("/auth/freebuff/session", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new ApiError(response.status, "Gagal memeriksa sesi akun.");
  }
  const body = await readJson(response);
  if (!body || typeof body !== "object") {
    throw new ApiError(500, "Respons sesi tidak dikenali.");
  }
  return (body.user as SessionUser | null) ?? null;
}

export async function fetchState(): Promise<StateSnapshot> {
  const response = await fetch("/api/data", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.status === 401 ? "Sesi berakhir." : "Gagal memuat data akun.",
    );
  }

  const body = await readJson(response);
  if (!body || typeof body.revision !== "number") {
    throw new ApiError(500, "Respons data tidak dikenali.");
  }

  return {
    data: (body.data as Database | null) ?? null,
    revision: body.revision,
    updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : null,
  };
}

export async function fetchCorporateData(): Promise<CorporateData> {
  const response = await fetch("/api/corporate", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.status === 401
        ? "Sesi berakhir."
        : typeof body?.error === "string"
          ? body.error
          : "Gagal memuat Corporate Engine.",
    );
  }
  if (!body || !Array.isArray(body.leads) || !Array.isArray(body.cities)) {
    throw new ApiError(500, "Respons Corporate Engine tidak dikenali.");
  }
  return body as unknown as CorporateData;
}

export async function refreshCorporateCity(city: string): Promise<CorporateRefreshResult> {
  const response = await fetch("/api/corporate/refresh", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ city }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.status === 401
        ? "Sesi berakhir."
        : typeof body?.error === "string"
          ? body.error
          : "Gagal memperbarui data Corporate Engine.",
    );
  }
  if (!body || !Array.isArray(body.leads) || typeof body.updatedAt !== "string") {
    throw new ApiError(500, "Respons pembaruan tidak dikenali.");
  }
  return body as unknown as CorporateRefreshResult;
}

export interface CorporateEnrichResult {
  checked: number;
  found: number;
  remaining: number;
  updated: {
    id: string;
    email: string;
    phone: string;
    contactName?: string;
    contactRole?: string;
    contactUrl?: string;
    contactSource?: string;
  }[];
}

export interface CorporateLeadSearchResult {
  lead: CorporateLead;
  email: string;
  phone: string;
  contact: CorporatePerson | null;
  checked: number;
  found: boolean;
  webSearch?: { enabled: boolean; error?: string };
}

export async function enrichCorporateEmails(): Promise<CorporateEnrichResult> {
  const response = await fetch("/api/corporate/enrich", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.status === 401
        ? "Sesi berakhir."
        : typeof body?.error === "string"
          ? body.error
          : "Pencarian email belum berhasil.",
    );
  }
  if (!body || !Array.isArray(body.updated)) {
    throw new ApiError(500, "Respons pencarian email tidak dikenali.");
  }
  return body as unknown as CorporateEnrichResult;
}

export async function searchCorporateLead(id: string): Promise<CorporateLeadSearchResult> {
  const response = await fetch("/api/corporate/lead", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.status === 401
        ? "Sesi berakhir."
        : typeof body?.error === "string"
          ? body.error
          : "Pencarian kontak belum berhasil.",
    );
  }
  if (!body || !body.lead || typeof body.lead !== "object") {
    throw new ApiError(500, "Respons pencarian kontak tidak dikenali.");
  }
  return body as unknown as CorporateLeadSearchResult;
}

export interface CorporateCompanySyncResult {
  lead: CorporateLead;
  complete: boolean;
  missing: string[];
  message: string;
}

export async function syncCorporateCompany(
  company: Company,
): Promise<CorporateCompanySyncResult> {
  const response = await fetch("/api/corporate/prospect/sync", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      company: {
        id: company.id,
        sourceLeadId: company.sourceLeadId,
        name: company.name,
        website: company.website,
        email: company.email,
        location: company.location,
      },
    }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.status === 401
        ? "Sesi berakhir."
        : typeof body?.error === "string"
          ? body.error
          : "Robot belum bisa melengkapi data perusahaan ini.",
    );
  }
  if (!body || !body.lead || typeof body.lead !== "object") {
    throw new ApiError(500, "Respons tarik data Robot AI tidak dikenali.");
  }
  return body as unknown as CorporateCompanySyncResult;
}

export interface CorporateRobotSettingsInput {
  enabled?: boolean;
  autoPublish?: boolean;
  telegramChatId?: string;
}

function robotErrorMessage(body: Record<string, unknown> | null, fallback: string): string {
  return typeof body?.error === "string" ? body.error : fallback;
}

export async function fetchCorporateRobot(): Promise<CorporateRobotStatus> {
  const response = await fetch("/api/corporate/robot", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.status === 401
        ? "Sesi berakhir."
        : robotErrorMessage(body, "Gagal memuat status robot."),
    );
  }
  if (!body || !body.stats || !Array.isArray(body.jobs)) {
    throw new ApiError(500, "Respons status robot tidak dikenali.");
  }
  return body as unknown as CorporateRobotStatus;
}

export async function saveCorporateRobotSettings(
  input: CorporateRobotSettingsInput,
): Promise<CorporateRobotStatus> {
  const response = await fetch("/api/corporate/robot/settings", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.status === 401
        ? "Sesi berakhir."
        : robotErrorMessage(body, "Pengaturan robot belum bisa disimpan."),
    );
  }
  if (!body || !body.stats || !Array.isArray(body.jobs)) {
    throw new ApiError(500, "Respons pengaturan robot tidak dikenali.");
  }
  return body as unknown as CorporateRobotStatus;
}

export async function runCorporateRobot(limit = 2): Promise<CorporateRobotRunResult> {
  const response = await fetch("/api/corporate/robot/run", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.status === 401
        ? "Sesi berakhir."
        : robotErrorMessage(body, "Robot belum bisa dijalankan."),
    );
  }
  if (!body || !body.status || !Array.isArray(body.updated)) {
    throw new ApiError(500, "Respons robot tidak dikenali.");
  }
  return body as unknown as CorporateRobotRunResult;
}

export async function detectCorporateRobotTelegram(): Promise<{
  ok: boolean;
  chatId?: string;
  message: string;
}> {
  const response = await fetch("/api/corporate/robot/telegram/detect", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.status === 401
        ? "Sesi berakhir."
        : robotErrorMessage(body, "Deteksi chat ID belum berhasil."),
    );
  }
  return {
    ok: Boolean(body?.ok),
    chatId: typeof body?.chatId === "string" ? body.chatId : undefined,
    message:
      typeof body?.message === "string" ? body.message : "Deteksi chat ID selesai.",
  };
}

export async function testCorporateRobotTelegram(): Promise<{ ok: boolean; message: string }> {
  const response = await fetch("/api/corporate/robot/telegram/test", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.status === 401
        ? "Sesi berakhir."
        : robotErrorMessage(body, "Tes Telegram belum berhasil."),
    );
  }
  return {
    ok: Boolean(body?.ok),
    message:
      typeof body?.message === "string" ? body.message : "Tes Telegram selesai.",
  };
}

export async function retryCorporateRobotTelegram(): Promise<{
  ok: boolean;
  requeued: number;
  sent: number;
  message: string;
}> {
  const response = await fetch("/api/corporate/robot/telegram/retry", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.status === 401
        ? "Sesi berakhir."
        : robotErrorMessage(body, "Pesan macet belum bisa dikirim ulang."),
    );
  }
  return {
    ok: Boolean(body?.ok),
    requeued: Number(body?.requeued || 0),
    sent: Number(body?.sent || 0),
    message:
      typeof body?.message === "string"
        ? body.message
        : "Pesan macet selesai diproses.",
  };
}

export function pdfUrl(fileId: string): string {
  return `/api/files/${encodeURIComponent(fileId)}`;
}

export function downloadUrl(fileId: string): string {
  return `${pdfUrl(fileId)}?download=1`;
}

export interface WhatsAppWindowStatus {
  configured: boolean;
  webhookConfigured: boolean;
  phone: string;
  open: boolean;
  lastInboundAt: string;
  expiresAt: string;
}

export interface WhatsAppSendInput {
  fileId: string;
  phone: string;
  filename: string;
  message: string;
}

export interface WhatsAppSendResult {
  ok: boolean;
  messageId?: string;
  to?: string;
  error?: string;
  windowOpen?: boolean;
}

export async function fetchWhatsAppStatus(phone: string): Promise<WhatsAppWindowStatus> {
  const response = await fetch(`/api/whatsapp/status?phone=${encodeURIComponent(phone)}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.status === 401
        ? "Sesi berakhir."
        : typeof body?.error === "string"
          ? body.error
          : "Status WhatsApp belum bisa dimuat.",
    );
  }
  return {
    configured: Boolean(body?.configured),
    webhookConfigured: Boolean(body?.webhookConfigured),
    phone: typeof body?.phone === "string" ? body.phone : "",
    open: Boolean(body?.open),
    lastInboundAt: typeof body?.lastInboundAt === "string" ? body.lastInboundAt : "",
    expiresAt: typeof body?.expiresAt === "string" ? body.expiresAt : "",
  };
}

export async function sendQuoteWhatsApp(
  input: WhatsAppSendInput,
): Promise<WhatsAppSendResult> {
  const response = await fetch("/api/whatsapp/send", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.status === 401
        ? "Sesi berakhir."
        : typeof body?.error === "string"
          ? body.error
          : "PDF belum bisa dikirim otomatis.",
    );
  }
  return {
    ok: Boolean(body?.ok),
    messageId: typeof body?.messageId === "string" ? body.messageId : undefined,
    to: typeof body?.to === "string" ? body.to : undefined,
    error: typeof body?.error === "string" ? body.error : undefined,
    windowOpen: body?.windowOpen === true,
  };
}

export async function uploadPdf(file: File): Promise<StoredFile> {
  const form = new FormData();
  form.append("file", file, file.name);

  const response = await fetch("/api/files", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    body: form,
  });

  const body = await readJson(response);

  if (!response.ok) {
    const status = response.status;
    const message =
      status === 401
        ? "Sesi berakhir. Silakan masuk lagi."
        : status === 413
          ? "Ukuran PDF melebihi batas 15 MB."
          : status === 415
            ? "File harus berupa PDF."
            : typeof body?.error === "string"
              ? body.error
              : "Gagal mengunggah PDF.";
    throw new ApiError(status, message);
  }

  const uploaded = body?.file as StoredFile | undefined;
  if (!uploaded || typeof uploaded.id !== "string") {
    throw new ApiError(500, "Respons unggahan tidak dikenali.");
  }
  return uploaded;
}

export async function deletePdf(fileId: string): Promise<void> {
  const response = await fetch(pdfUrl(fileId), {
    method: "DELETE",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.status === 401
        ? "Sesi berakhir. Silakan masuk lagi."
        : "Gagal menghapus file PDF.",
    );
  }
}

export async function pushState(data: Database, baseRevision: number): Promise<SaveResult> {
  const response = await fetch("/api/data", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data, baseRevision }),
  });

  const body = await readJson(response);

  if (response.status === 409) {
    return {
      conflict: true,
      revision: typeof body?.revision === "number" ? body.revision : baseRevision,
      data: (body?.data as Database | null) ?? null,
      updatedAt: typeof body?.updatedAt === "string" ? body.updatedAt : null,
    };
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof body?.error === "string" ? body.error : "Gagal menyimpan data.",
    );
  }

  if (!body || typeof body.revision !== "number") {
    throw new ApiError(500, "Respons simpan tidak dikenali.");
  }

  return {
    conflict: false,
    revision: body.revision,
    updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : new Date().toISOString(),
  };
}
