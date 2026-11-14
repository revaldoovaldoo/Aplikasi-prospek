import { useLayoutEffect, useState } from "react";
import type { PoPinCredential } from "../types";
import { createPoPin, isValidPoPin, normalizePoPin, verifyPoPin } from "../lib/poPin";
import { Modal } from "./Dialogs";
import { KeyIcon, LockIcon } from "./icons";

export type PoPinMode = "setup" | "unlock" | "change" | "forgot" | "reset";

interface Props {
  open: boolean;
  mode: PoPinMode;
  credential?: PoPinCredential;
  profileEmail: string;
  accountEmail: string;
  onClose: () => void;
  onSave: (credential: PoPinCredential) => void;
  onUnlocked: () => void;
}

const TITLES: Record<PoPinMode, string> = {
  setup: "Buat PIN Password PO",
  unlock: "Komisi terkunci",
  change: "Change PIN Password PO",
  forgot: "Forgot PIN Password PO",
  reset: "PIN Password PO baru",
};

const SUBTITLES: Record<PoPinMode, string> = {
  setup: "Buat PIN 6 digit angka. PIN ini dipakai untuk membuka nilai komisi PO.",
  unlock: "Masukkan PIN 6 digit untuk melihat jumlah komisi.",
  change: "Masukkan PIN lama, lalu tentukan PIN baru.",
  forgot: "Masukkan e-mail yang tersimpan di profil untuk memulihkan akses.",
  reset: "Tentukan PIN 6 digit yang baru untuk membuka komisi.",
};

export default function PoPinDialog({
  open,
  mode,
  credential,
  profileEmail,
  accountEmail,
  onClose,
  onSave,
  onUnlocked,
}: Props) {
  const [step, setStep] = useState<PoPinMode>(mode);
  const [oldPin, setOldPin] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useLayoutEffect(() => {
    if (!open) return;
    setStep(mode);
    setOldPin("");
    setPin("");
    setConfirm("");
    setEmail(profileEmail.trim() || accountEmail.trim());
    setError("");
    setBusy(false);
  }, [open, mode, profileEmail, accountEmail]);

  const resetFields = () => {
    setOldPin("");
    setPin("");
    setConfirm("");
    setError("");
  };

  const goTo = (next: PoPinMode) => {
    resetFields();
    setStep(next);
  };

  async function submit() {
    if (busy) return;
    setError("");

    if (step === "forgot") {
      const expected = (profileEmail.trim() || accountEmail.trim()).toLowerCase();
      const entered = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entered)) {
        setError("Alamat e-mail belum benar.");
        return;
      }
      if (!expected) {
        setError("E-mail profil belum diisi. Lengkapi profil terlebih dahulu.");
        return;
      }
      if (entered !== expected) {
        setError("E-mail tidak cocok dengan e-mail yang tersimpan di profil.");
        return;
      }
      setPin("");
      setConfirm("");
      setStep("reset");
      return;
    }

    if (step === "unlock") {
      if (!isValidPoPin(pin)) {
        setError("PIN harus tepat 6 digit angka.");
        return;
      }
      setBusy(true);
      try {
        const valid = credential ? await verifyPoPin(pin, credential) : false;
        if (!valid) {
          setError("PIN salah. Coba lagi.");
        } else {
          onUnlocked();
        }
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!isValidPoPin(pin)) {
      setError("PIN harus tepat 6 digit angka.");
      return;
    }
    if (pin !== confirm) {
      setError("Ulangi PIN dengan angka yang sama.");
      return;
    }

    if (step === "change") {
      if (!isValidPoPin(oldPin)) {
        setError("Masukkan PIN lama 6 digit.");
        return;
      }
      if (!credential) {
        setError("PIN lama tidak ditemukan. Gunakan Forgot PIN Password PO.");
        return;
      }
    }

    setBusy(true);
    try {
      if (step === "change" && credential) {
        const valid = await verifyPoPin(oldPin, credential);
        if (!valid) {
          setError("PIN lama salah. Coba lagi.");
          return;
        }
      }

      const next = await createPoPin(pin);
      onSave(next);
      onUnlocked();
    } catch {
      setError("PIN belum bisa disimpan. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  const showNewPin = step === "setup" || step === "change" || step === "reset";
  const actionLabel =
    step === "forgot"
      ? "Verifikasi e-mail"
      : step === "unlock"
        ? "Buka komisi"
        : "Simpan PIN";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={TITLES[step]}
      subtitle={SUBTITLES[step]}
      width={440}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Batal
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>
            {busy ? "Memproses…" : actionLabel}
          </button>
        </>
      }
    >
      <div className="po-pin-panel">
        <span className="po-pin-emblem">
          {step === "unlock" || step === "forgot" ? <LockIcon size={20} /> : <KeyIcon size={20} />}
        </span>

        {step === "forgot" ? (
          <label className="field po-pin-field" htmlFor="po-pin-email">
            <span>E-mail profil</span>
            <input
              id="po-pin-email"
              type="email"
              inputMode="email"
              autoFocus
              value={email}
              placeholder="nama@perusahaan.com"
              onChange={(event) => {
                setEmail(event.target.value);
                setError("");
              }}
            />
            <span className="field-hint">
              Gunakan e-mail yang sama dengan yang tersimpan di profil. Verifikasi memakai akun
              Freebuff yang sedang masuk, jadi tidak ada kode yang dikirim ke e-mail.
            </span>
          </label>
        ) : null}

        {step === "unlock" || step === "change" ? (
          <label className="field po-pin-field" htmlFor="po-pin-old">
            <span>{step === "unlock" ? "PIN 6 digit" : "PIN lama"}</span>
            <input
              id="po-pin-old"
              className="po-pin-input"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              autoFocus
              maxLength={6}
              value={step === "unlock" ? pin : oldPin}
              placeholder="••••••"
              onChange={(event) => {
                const next = normalizePoPin(event.target.value);
                if (step === "unlock") setPin(next);
                else setOldPin(next);
                setError("");
              }}
            />
          </label>
        ) : null}

        {showNewPin ? (
          <>
            <label className="field po-pin-field" htmlFor="po-pin-new">
              <span>{step === "change" ? "PIN baru" : "PIN 6 digit"}</span>
              <input
                id="po-pin-new"
                className="po-pin-input"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                autoFocus={step !== "change"}
                maxLength={6}
                value={pin}
                placeholder="••••••"
                onChange={(event) => {
                  setPin(normalizePoPin(event.target.value));
                  setError("");
                }}
              />
            </label>
            <label className="field po-pin-field" htmlFor="po-pin-confirm">
              <span>Ulangi PIN</span>
              <input
                id="po-pin-confirm"
                className="po-pin-input"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={6}
                value={confirm}
                placeholder="••••••"
                onChange={(event) => {
                  setConfirm(normalizePoPin(event.target.value));
                  setError("");
                }}
              />
            </label>
          </>
        ) : null}

        {step === "unlock" ? (
          <button
            type="button"
            className="link-btn po-pin-forgot"
            onClick={() => goTo("forgot")}
          >
            Lupa PIN?
          </button>
        ) : null}

        {step === "reset" ? (
          <p className="po-pin-note">
            E-mail profil cocok. Setelah PIN baru disimpan, PIN lama tidak berlaku lagi.
          </p>
        ) : null}

        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </Modal>
  );
}
