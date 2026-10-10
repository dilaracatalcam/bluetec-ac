import { useState, useEffect, useCallback } from "react";
import {
  HiOutlineArrowUpTray, HiOutlinePencilSquare, HiOutlineArrowRight,
} from "react-icons/hi2";

/* ── Genel Bakış ──
   Kullanıcının kapsamındaki cihazların özeti (bkz. /api/overview).
   Sayfa açıkken backend cihazları arka planda sırayla tarar; burada 30sn'de bir
   sessizce (yükleniyor göstergesi olmadan) son okunan değerler çekilir.
*/

// Cihaz durumları 6 gruba toplanır; renk gruba aittir (sıraya/adede göre değişmez).
const STATE_GROUPS = [
  { key: "charging", label: "Şarj Oluyor",   color: "#2a78d6", states: ["charging"] },
  { key: "free",     label: "Müsait",        color: "#0ca30c", states: ["not_plugged", "idle"] },
  { key: "plugged",  label: "Soket Takılı",  color: "#eda100", states: ["waiting_rfid", "charge_ended"] },
  { key: "error",    label: "Hata",          color: "#d03b3b", states: ["error"] },
  { key: "offline",  label: "Çevrimdışı",    color: "#898781", states: ["offline"] },
  { key: "unknown",  label: "Bilinmiyor",    color: "#c3c2b7", states: ["unknown", "never"] },
];

const JOB_STATUS = {
  running: { label: "Çalışıyor",   cls: "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-border)]" },
  done:    { label: "Tamamlandı",  cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
  stopped: { label: "Durduruldu",  cls: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
};

function timeAgo(iso) {
  if (!iso) return "—";
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "az önce";
  if (min < 60) return `${min} dk önce`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} sa önce`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} gün önce`;
  return new Date(iso).toLocaleDateString("tr-TR");
}

const cardCls = "bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.05)]";

// Durum kutusu: solda grubun rengiyle ince şerit + nokta, büyük adet, yanında yüzde.
// Renk yalnızca şerit ve noktada; yazılar metin renginde kalır.
function StatTile({ color, label, hint, value, pct }) {
  return (
    <div className={`${cardCls} relative overflow-hidden px-4 py-3.5`}>
      {color && <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: color }} />}
      <div className="flex items-center gap-2">
        {color && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />}
        <span className={`truncate ${color ? "text-[13px] font-semibold text-[var(--text-primary)]" : "text-[11px] font-bold tracking-[0.12em] uppercase text-[var(--text-muted)]"}`}>{label}</span>
      </div>
      <div className="flex items-baseline gap-2 mt-1.5">
        <span className="text-[30px] leading-none font-bold font-display text-[var(--text-primary)] tabular-nums">{value}</span>
        {pct !== undefined && <span className="text-[12px] font-medium text-[var(--text-muted)] tabular-nums">%{pct}</span>}
      </div>
      {hint && <div className="text-[12px] text-[var(--text-muted)] mt-1.5 truncate">{hint}</div>}
    </div>
  );
}

function Card({ title, subtitle, action, children, className = "" }) {
  return (
    <section className={`${cardCls} ${className}`}>
      <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-[var(--border-subtle)]">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold font-display text-[var(--text-primary)]">{title}</h3>
          {subtitle && <p className="text-[12px] text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function LinkBtn({ onClick, children }) {
  return (
    <button onClick={onClick}
      className="shrink-0 flex items-center gap-1 text-[12px] font-semibold text-[var(--accent)] hover:underline cursor-pointer">
      {children} <HiOutlineArrowRight className="text-[12px]" />
    </button>
  );
}

const Empty = ({ children }) => <p className="text-[13px] text-[var(--text-muted)] italic">{children}</p>;

export default function Overview({ token, currentUser, onNavigate, canOpen = () => true }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/overview", { headers: { "Authorization": `Bearer ${token}` } });
      const d = await r.json();
      if (!r.ok || !Array.isArray(d.states)) { setError(d.error || "Özet alınamadı"); return; }
      setError("");
      setData(d);
    } catch {
      setError("Sunucuya ulaşılamadı");
    }
  }, [token]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, [load]);

  const today = new Date().toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", weekday: "long" });

  const header = (
    <div className="flex items-end justify-between gap-3 flex-wrap mb-5">
      <div>
        <h1 className="text-[26px] font-bold font-display tracking-tight text-[var(--text-primary)]">Genel Bakış</h1>
        <p className="text-[14px] text-[var(--text-muted)] mt-0.5">
          {currentUser?.fullName ? `Hoş geldiniz, ${currentUser.fullName}. ` : ""}Cihazlarınızın genel durumu aşağıda.
        </p>
      </div>
      <div className="text-[13px] font-semibold text-[var(--text-secondary)]">{today}</div>
    </div>
  );

  if (!data) {
    return <div>{header}<div className={`${cardCls} p-6`}><Empty>{error || "Yükleniyor…"}</Empty></div></div>;
  }

  const total = data.totalDevices;
  const groupCounts = (states) => STATE_GROUPS.map((g) => ({
    ...g, count: g.states.reduce((n, st) => n + (states[st] || 0), 0),
  }));
  const allStates = Object.fromEntries(data.states.map((x) => [x.state, x.count]));
  const groups = groupCounts(allStates);
  const count = (key) => groups.find((g) => g.key === key).count;
  const online = total - count("offline") - count("unknown");
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
  const lastRead = data.lastStatusAt ? `En son okuma: ${timeAgo(data.lastStatusAt)}` : "Henüz okuma yapılmadı";

  const topVersions = data.versions.slice(0, 6);
  const otherVersions = data.versions.slice(6).reduce((n, v) => n + v.count, 0);
  const versionRows = otherVersions ? [...topVersions, { version: "diğer", count: otherVersions }] : topVersions;
  const maxVersion = Math.max(1, ...versionRows.map((v) => v.count));

  return (
    <div>
      {header}
      {error && <p className="text-[13px] text-rose-500 mb-3">{error}</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-4">
        <StatTile label="Toplam Cihaz" value={total} hint={`${online} çevrimiçi`} />
        {groups.map((g) => (
          <StatTile key={g.key} color={g.color} label={g.label} value={g.count} pct={pct(g.count)} />
        ))}
      </div>

      <Card className="mb-4" title="Şirketlere Göre Durum" subtitle={lastRead}
        action={canOpen("device-status") && <LinkBtn onClick={() => onNavigate("device-status")}>Toplu Okuma</LinkBtn>}>
        {data.companies.length === 0 ? <Empty>Görüntülenecek cihaz yok.</Empty> : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              {data.companies.map((c) => {
                // Eski backend (yeniden başlatılmadan önce) şirket başına sadece charging/offline
                // döndürüyordu — o durumda oran çubuğu yanıltıcı olacağı için çizilmez.
                const hasStates = !!c.states;
                const cg = groupCounts(c.states || { charging: c.charging || 0, offline: c.offline || 0 }).filter((g) => g.count > 0);
                return (
                  <div key={c.company} className="rounded-lg border border-[var(--border-subtle)] px-3.5 pt-3 pb-3"
                    title={cg.map((g) => `${g.label}: ${g.count}`).join(" · ")}>
                    <div className="text-[13px] font-bold text-[var(--text-primary)] truncate">{c.company}</div>
                    <div className="text-[12px] text-[var(--text-muted)]">{c.total} cihaz</div>
                    <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-2.5 min-h-[20px]">
                      {cg.map((g) => (
                        <span key={g.key} className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--text-secondary)] tabular-nums">
                          <span className="w-2 h-2 rounded-full" style={{ background: g.color }} />{g.count}
                        </span>
                      ))}
                    </div>
                    <div className="flex h-1.5 w-full gap-[2px] mt-2.5">
                      {hasStates && cg.map((g) => (
                        <div key={g.key} className="h-full rounded-full min-w-[3px]" style={{ flexGrow: g.count, flexBasis: 0, background: g.color }} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <ul className="flex items-center gap-x-5 gap-y-2 flex-wrap mt-4 pt-4 border-t border-[var(--border-subtle)]">
              {STATE_GROUPS.map((g) => (
                <li key={g.key} className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                  <span className="w-3.5 h-2.5 rounded-[3px]" style={{ background: g.color }} />{g.label}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
        {data.activeConnections ? (
          <Card title="Aktif Bağlantılar" subtitle="Şu an cihaza bağlı kullanıcılar"
            action={canOpen("connections") && <LinkBtn onClick={() => onNavigate("connections")}>Tümü</LinkBtn>}>
            {data.activeConnections.length === 0 ? <Empty>Şu an bağlı kullanıcı yok.</Empty> : (
              <ul className="space-y-3">
                {data.activeConnections.slice(0, 5).map((c, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-lg bg-[var(--bg-subtle)] text-[var(--text-secondary)] flex items-center justify-center text-[13px] font-bold shrink-0">
                      {c.fullName.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-[var(--text-primary)] truncate">{c.fullName}</span>
                      <span className="block text-[12px] text-[var(--text-muted)] truncate">{c.device}{c.company ? ` · ${c.company}` : ""}</span>
                    </span>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" title="Bağlı" />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : (
          <Card title="Bağlantı Tipi" subtitle="Cihazların bağlantı türüne göre dağılımı">
            <ul className="space-y-2.5">
              {data.connTypes.map((c) => (
                <li key={c.type} className="flex items-center justify-between text-[13px]">
                  <span className="text-[var(--text-secondary)]">{c.type}</span>
                  <span className="font-bold text-[var(--text-primary)] tabular-nums">{c.count}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title="Son İşlemler" subtitle="Toplu parametre ve güncelleme işleri">
          {data.recentJobs.length === 0 ? <Empty>Henüz toplu işlem yok.</Empty> : (
            <ul className="space-y-3.5">
              {data.recentJobs.slice(0, 6).map((j) => {
                const st = JOB_STATUS[j.status] || { label: j.status, cls: "bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border-subtle)]" };
                return (
                  <li key={`${j.type}-${j.id}`} className="flex items-start gap-3" title={`Başlatan: ${j.created_by}`}>
                    <span className="w-8 h-8 rounded-lg bg-[var(--bg-subtle)] text-[var(--text-secondary)] flex items-center justify-center text-[15px] shrink-0">
                      {j.type === "ota" ? <HiOutlineArrowUpTray /> : <HiOutlinePencilSquare />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-[var(--text-primary)] truncate">
                        {j.type === "ota" ? `${String(j.title || "").toUpperCase()} güncelleme` : (j.title || "Parametre")}
                        {j.company ? ` · ${j.company}` : ""}
                      </span>
                      <span className="block text-[12px] text-[var(--text-muted)] truncate">
                        {j.ok}/{j.total} başarılı · {timeAgo(j.created_at)}
                      </span>
                    </span>
                    <span className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Yazılım Sürümleri" subtitle="ESP yazılım sürümüne göre cihaz sayısı">
        {versionRows.length === 0 ? <Empty>Sürüm bilgisi yok.</Empty> : (
          <ul className="space-y-2.5">
            {versionRows.map((v) => (
              <li key={v.version} className="flex items-center gap-3" title={`${v.version}: ${v.count} cihaz`}>
                <span className="w-24 shrink-0 text-[12px] font-mono text-[var(--text-secondary)] truncate">{v.version}</span>
                <span className="flex-1 h-2.5">
                  <span className={`block h-full rounded-r-[4px] ${v.version === "diğer" ? "bg-[var(--text-muted)] opacity-50" : "bg-[var(--accent)]"}`} style={{ width: `${Math.max(1, (v.count / maxVersion) * 100)}%` }} />
                </span>
                <span className="w-8 shrink-0 text-right text-[13px] font-bold text-[var(--text-primary)] tabular-nums">{v.count}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
