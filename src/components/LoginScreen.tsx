import { CheckIcon, SparkIcon } from "./icons";

export default function LoginScreen() {
  return (
    <div className="auth-screen">
      <section className="auth-visual">
        <div className="auth-brand">
          <span className="brand-mark">P</span>
          <div>
            <strong>Hallo Pane</strong>
            <span>Prospek &amp; penawaran</span>
          </div>
        </div>

        <div className="auth-copy">
          <p className="eyebrow auth-eyebrow">ASNET PANE</p>
          <h1>
            Kelola prospek, terbitkan penawaran, simpan dalam satu akun.
          </h1>
          <p className="auth-lead">
            Catat kunjungan perusahaan, buat draft penawaran A4, lalu buka datanya
            dari tablet maupun komputer.
          </p>
          <ul className="auth-points">
            <li>
              <CheckIcon size={15} />
              Data tersimpan di akun Freebuff, bukan di satu browser.
            </li>
            <li>
              <CheckIcon size={15} />
              Nomor penawaran otomatis format 001/UAS/QUOT-PANE/…
            </li>
            <li>
              <CheckIcon size={15} />
              Draft bisa diedit langsung lalu disimpan sebagai PDF.
            </li>
          </ul>
        </div>

        <div className="auth-doc" aria-hidden="true">
          <div className="auth-doc-head">
            <span className="auth-doc-logo">UAS</span>
            <div>
              <strong>PT. USAHA ADI SANGGORO</strong>
              <span>Internet Broadband · Data Center · Hosting</span>
            </div>
          </div>
          <div className="auth-doc-meta">
            <span>
              Nomor : <strong>001/UAS/QUOT-PANE/VII/2026</strong>
            </span>
            <span>Bogor, 27 Juli 2026</span>
          </div>
          <div className="auth-doc-lines">
            <span />
            <span />
            <span className="short" />
          </div>
          <div className="auth-doc-table">
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="auth-doc-lines tight">
            <span />
            <span />
            <span className="short" />
          </div>
          <div className="auth-doc-stamp">Penawaran</div>
        </div>

        <p className="auth-brandline">PT. Usaha Adi Sanggoro · Internet Broadband Division</p>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <span className="auth-card-icon">
            <SparkIcon size={20} />
          </span>
          <h2>Masuk untuk melanjutkan</h2>
          <p className="auth-card-sub">
            Gunakan akun Freebuff Anda. Bisa lewat Google, GitHub, atau Apple.
          </p>
          <a
            className="btn btn-primary btn-block auth-submit"
            href="/auth/freebuff/signin?returnTo=%2F"
          >
            Masuk dengan Freebuff
          </a>
          <p className="auth-note">
            Data prospek dan penawaran hanya bisa dibuka setelah Anda masuk, dan
            tersinkron di semua perangkat yang memakai akun yang sama.
          </p>
        </div>
        <p className="auth-foot">Hallo Pane · ASNET</p>
      </section>
    </div>
  );
}
