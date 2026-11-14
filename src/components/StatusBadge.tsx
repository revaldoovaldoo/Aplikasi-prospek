import type { CompanyStatus } from "../lib/data";
import { quoteStatusLabel } from "../lib/data";

const TONES: Record<CompanyStatus, string> = {
  prospek: "badge-muted",
  penawaran: "badge-blue",
  "tidak-jadi": "badge-red",
  po: "badge-green",
  "bast-terkirim": "badge-blue",
  "bast-selesai": "badge-green",
};

export default function StatusBadge({ status }: { status: CompanyStatus }) {
  return <span className={`badge ${TONES[status]}`}>{quoteStatusLabel(status)}</span>;
}
