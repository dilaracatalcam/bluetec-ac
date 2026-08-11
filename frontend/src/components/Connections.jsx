import { useState, useEffect, useCallback } from "react";
import {
  HiOutlineSignal, HiOutlineUserCircle, HiOutlineUser,
  HiOutlineShieldCheck, HiOutlineArrowPath, HiOutlineCpuChip, HiOutlineXMark
} from "react-icons/hi2";

/* ── Connections ──
   Admin ve superadmin için aktif bağlantı listesi.
   /api/connections 5sn'de bir okur, ekrana basar.

   Cevap formatı:
   {
     myMac: "DC:DA:0C:..." | null,
     connections: [
       { session_id, username, fullName, role, target, isSelf, sameMac }
     ]
   }
*/

const ROLE_LABELS = {
  superadmin: "Superadmin",
  admin: "Admin",
  operator: "Operator",
};

const ROLE_COLORS = {
  superadmin: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  admin:      "bg-amber-500/15  text-amber-500  border-amber-500/30",
  operator:   "bg-sky-500/15    text-sky-500    border-sky-500/30",
};

const ROLE_ICONS = {
  superadmin: <HiOutlineShieldCheck />,
  admin:      <HiOutlineUserCircle />,
  operator:   <HiOutlineUser />,
};

export default function Connections({ token, isSuperadmin }) {
  const [data, setData] = useState({ connections: [], myMac: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [disconnecting, setDisconnecting] = useState(null); // session_id | null

  const authFetch = useCallback((url, opts = {}) =>
    fetch(url, { ...opts, headers: { ...(opts.headers || {}), "Authorization": `Bearer ${token}` } })
  , [token]);

  const load = useCallback(async () => {
    try {
      const r = await authFetch("/api/connections");
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error || `Liste yüklenemedi (${r.status})`);
        return;
      }
      const j = await r.json();
      setData({ connections: j.connections || [], myMac: j.myMac || null });
      setError("");
    } catch {
      setError("Sunucuya ulaşılamadı");
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [load]);

  const handleDisconnect = async (c) => {
    if (!window.confirm(`${c.fullName || c.username} (@${c.username}) kullanıcısının bağlantısını kesmek istediğinize emin misiniz?`)) return;
    setDisconnecting(c.session_id);
    try {
      const r = await authFetch(`/api/connections/${encodeURIComponent(c.session_id)}/disconnect`, { method: "POST" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error || "Bağlantı kesilemedi");
        return;
      }
      await load();
    } catch {
      setError("Sunucuya ulaşılamadı");
    } finally {
      setDisconnecting(null);
    }
  };

  // MAC bazlı gruplama
  const groupedByMac = {};
  for (const c of data.connections) {
    if (!groupedByMac[c.target]) groupedByMac[c.target] = [];
    groupedByMac[c.target].push(c);
  }

  return (
    <>
      <div className="mb-5 pb-4 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--accent-soft)] border border-[var(--accent-border)] flex items-center justify-center text-[var(--accent)] text-[18px] shrink-0">
            <HiOutlineSignal />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-bold text-[var(--text-primary)] font-display tracking-tight leading-tight">
              Aktif Bağlantılar
            </h2>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              Şu anda hangi kullanıcı hangi şarj cihazına bağlı
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-[5px] rounded-md border transition tracking-wide uppercase
                       bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-border)] hover:bg-[var(--accent-soft-hover)] cursor-pointer disabled:opacity-50"
          >
            <HiOutlineArrowPath className={`text-[12px] ${loading ? "animate-spin" : ""}`} />
            Yenile
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-500 text-[12px]">
          {error}
        </div>
      )}

      {data.connections.length === 0 && !loading && (
        <div className="text-center py-10 text-[12px] text-[var(--text-muted)]">
          Şu anda aktif bağlantı yok
        </div>
      )}

      <div className="space-y-4">
        {Object.entries(groupedByMac).map(([mac, conns]) => (
          <div key={mac} className="bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-xl overflow-hidden">
            {/* MAC başlık */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-sunken)]">
              <HiOutlineCpuChip className="text-[14px] text-[var(--accent)]" />
              <span className="text-[12px] font-mono font-bold text-[var(--text-primary)] tracking-tight">{mac}</span>
              <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-[1px] rounded bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-border)] ml-auto">
                {conns.length} {conns.length === 1 ? "kullanıcı" : "kullanıcı"}
              </span>
              {mac === data.myMac && (
                <span className="text-[9px] font-bold tracking-wider uppercase px-1.5 py-[1px] rounded bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
                  Sen burada
                </span>
              )}
            </div>

            {/* Kullanıcı listesi */}
            <div className="divide-y divide-[var(--border-subtle)]">
              {conns.map((c) => (
                <div key={c.session_id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className={`w-8 h-8 rounded-lg border flex items-center justify-center text-[14px] shrink-0 ${ROLE_COLORS[c.role] || ROLE_COLORS.operator}`}>
                    {ROLE_ICONS[c.role] || ROLE_ICONS.operator}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12px] font-semibold text-[var(--text-primary)] font-display">
                        {c.fullName || c.username}
                      </span>
                      {c.isSelf && (
                        <span className="text-[9px] font-bold tracking-wider uppercase px-1.5 py-[1px] rounded bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-border)]">
                          Sen
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">
                      @{c.username}
                    </div>
                  </div>
                  <span className={`text-[9px] font-bold tracking-wider uppercase px-1.5 py-[1px] rounded border ${ROLE_COLORS[c.role] || ROLE_COLORS.operator}`}>
                    {ROLE_LABELS[c.role] || c.role}
                  </span>
                  {isSuperadmin && !c.isSelf && (
                    <button
                      onClick={() => handleDisconnect(c)}
                      disabled={disconnecting === c.session_id}
                      title="Bağlantısını kes"
                      className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-md border transition tracking-wide uppercase shrink-0
                                 bg-rose-500/10 text-rose-500 border-rose-500/30 hover:bg-rose-500/20 cursor-pointer disabled:opacity-50"
                    >
                      <HiOutlineXMark className="text-[12px]" />
                      {disconnecting === c.session_id ? "Kesiliyor…" : "Kopar"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}