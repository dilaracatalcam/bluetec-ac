/* ── Canlı Telemetri "hero" görseli — fütüristik HUD ──
   Araç merkezde, 4 köşede yüzen cam (glassmorphism) telemetri kartı,
   kartlardan aracın gerçek noktalarına (şarj soketi, batarya paneli,
   ön motor/invertör, arka teker/aks) 90/45 derece kıvrımlı SVG kılavuz
   çizgileri uzanıyor — çizgilerde sürekli akan neon enerji animasyonu,
   temas noktalarında nabız gibi atan (ping) halkalar var.

   Görsel şeffaf arka planlı bir kesim (yalnızca araç opak) — bu yüzden
   zemin ışığı/gölgesi gerçek DOM sırasıyla aracın arkasına konuyor,
   "yapıştırma resim" hissi vermiyor. */

// Koyu tema — şeffaf arka planlı (yalnızca araç opak) stilize kesim.
const HERO_IMAGE_DARK = "/brand/Code_Generated_Image.png";
// Açık tema — kendi (opak) beyaz arka planıyla gelen gerçek araç fotoğrafı.
// Farklı bir kadraj/poz olduğu için CONNECTORS_LIGHT ayrıca kalibre edildi
// (bkz. aşağıdaki koordinatlar — ImageMagick ile ızgara basıp göz kararı
// değil, gerçek piksel üstünde ölçülerek bulundu).
const HERO_IMAGE_LIGHT = "/brand/hero-car-light.jpg";
const NEON = "#38BDF8";

// Kart "çıkış" noktası (from) -> aracın gerçek özelliği (to). Yüzde
// koordinatları (0-100), görselin 1200x896 kadrajına göre.
const CONNECTORS_DARK = [
  { id: "power",    from: { x: 19, y: 23 }, elbow: { x: 19, y: 46 }, to: { x: 22, y: 58 } }, // Güç -> ön motor/invertör
  { id: "status",   from: { x: 81, y: 23 }, elbow: { x: 81, y: 28 }, to: { x: 80, y: 34 } }, // Durum -> şarj soketi
  { id: "energy",   from: { x: 19, y: 77 }, elbow: { x: 42, y: 77 }, to: { x: 57, y: 64 } }, // Enerji -> batarya paneli (kapı altı)
  { id: "duration", from: { x: 81, y: 77 }, elbow: { x: 81, y: 56 }, to: { x: 78, y: 50 } }, // Süre -> arka teker/aks
];
// Açık tema fotoğrafındaki gerçek konumlara göre kalibre edildi (farklı araç,
// farklı açı — koyu temanınkiyle karıştırılmamalı).
const CONNECTORS_LIGHT = [
  { id: "power",    from: { x: 19, y: 23 }, elbow: { x: 19, y: 45 }, to: { x: 23, y: 62 } }, // Güç -> kaput/motor bölgesi
  { id: "status",   from: { x: 81, y: 23 }, elbow: { x: 81, y: 30 }, to: { x: 80, y: 37 } }, // Durum -> şarj soketi (parlayan konnektör)
  { id: "energy",   from: { x: 19, y: 77 }, elbow: { x: 40, y: 77 }, to: { x: 58, y: 65 } }, // Enerji -> alt kısım/batarya bölgesi
  { id: "duration", from: { x: 81, y: 77 }, elbow: { x: 81, y: 60 }, to: { x: 79, y: 58 } }, // Süre -> arka teker
];

const STATE_META = {
  offline:  { dot: "#fb7185", chip: "bg-rose-500/15 text-rose-300 border-rose-400/30" },
  charging: { dot: "#10b981", chip: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30" },
  plugged:  { dot: "#fbbf24", chip: "bg-amber-500/15 text-amber-300 border-amber-400/30" },
  error:    { dot: "#f43f5e", chip: "bg-rose-500/15 text-rose-300 border-rose-400/30" },
  idle:     { dot: NEON,      chip: "bg-sky-500/15 text-sky-300 border-sky-400/30" },
};
// Açık tema rozetleri — koyu temanın "yarı saydam parlak" pastel'i yerine
// düz, okunaklı soft badge (açık zemin + koyu metin) kullanılıyor.
const STATE_META_LIGHT = {
  offline:  { chip: "bg-rose-50 text-rose-700 border-rose-200" },
  charging: { chip: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  plugged:  { chip: "bg-amber-50 text-amber-700 border-amber-200" },
  error:    { chip: "bg-rose-50 text-rose-700 border-rose-200" },
  idle:     { chip: "bg-sky-50 text-sky-700 border-sky-200" },
};
// Açık temada bağlantı çizgileri durum rengine göre değil, sabit bir
// camgöbeği/mavi tonda — beyaz zeminde her durumda net okunsun diye.
const LIGHT_LINE_COLOR = "#0EA5E9";

function GroundGlow() {
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        background: "radial-gradient(ellipse 38% 26% at 50% 66%, rgba(56,189,248,0.55) 0%, rgba(56,189,248,0.2) 45%, rgba(56,189,248,0) 78%)",
        filter: "blur(20px)",
      }}
    />
  );
}

function ContactShadow() {
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        background: "radial-gradient(ellipse 26% 9% at 50% 69%, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 55%, rgba(0,0,0,0) 85%)",
        filter: "blur(8px)",
      }}
    />
  );
}

// Açık tema fotoğrafı KENDİ opak beyaz zeminiyle geliyor (ContactShadow'un
// aksine görselin ÜSTÜNE, teker tabanı hizasına) çizilmesi gerekiyor —
// aksi halde opak fotoğrafın arkasında kalıp hiç görünmez, araba "havada
// yüzüyor" hissi kalır.
function GroundShadowLight() {
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        background: "radial-gradient(ellipse 40% 6% at 54% 77%, rgba(15,23,42,0.32) 0%, rgba(15,23,42,0.14) 50%, rgba(15,23,42,0) 82%)",
        filter: "blur(6px)",
      }}
    />
  );
}

// Kart köşesinden araca uzanan, 90°/45° kıvrımlı "devre" çizgisi + üstünde
// sürekli akan neon enerji animasyonu (stroke-dasharray/dashoffset).
function LeaderLine({ c, color, delay }) {
  const d = `M ${c.from.x},${c.from.y} L ${c.elbow.x},${c.elbow.y} L ${c.to.x},${c.to.y}`;
  return (
    <>
      <path d={d} fill="none" stroke={color} strokeOpacity="0.18" strokeWidth="0.4" strokeLinecap="round" />
      <path d={d} fill="none" stroke={color} strokeWidth="0.35" strokeLinecap="round"
        strokeDasharray="3 5" className="hud-flow" style={{ animationDelay: `${delay}s` }} />
    </>
  );
}

// Açık tema için — dik köşeli elbow yerine "elbow" noktası bezier kontrol
// noktası olarak kullanılıp tek bir yumuşak eğri çiziliyor (daha organik).
// Beyaz zeminde ince çizgi görünürlüğü için opaklık/kalınlık biraz artırıldı.
function LeaderLineOrganic({ c, color, delay }) {
  const d = `M ${c.from.x},${c.from.y} Q ${c.elbow.x},${c.elbow.y} ${c.to.x},${c.to.y}`;
  return (
    <>
      <path d={d} fill="none" stroke={color} strokeOpacity="0.3" strokeWidth="0.45" strokeLinecap="round" />
      <path d={d} fill="none" stroke={color} strokeWidth="0.4" strokeLinecap="round"
        strokeDasharray="3 5" className="hud-flow" style={{ animationDelay: `${delay}s` }} />
    </>
  );
}

function ContactPoint({ x, y, color }) {
  return (
    <g>
      <circle cx={x} cy={y} r="1.3" fill={color} className="hud-ping" />
      <circle cx={x} cy={y} r="0.9" fill={color} />
    </g>
  );
}

function HudCard({ corner, icon, label, value, unit, accentChip, light }) {
  const CORNER = {
    tl: "top-3 left-3 sm:top-4 sm:left-4",
    tr: "top-3 right-3 sm:top-4 sm:right-4",
    bl: "bottom-3 left-3 sm:bottom-4 sm:left-4",
    br: "bottom-3 right-3 sm:bottom-4 sm:right-4",
  };
  const cardStyle = light
    ? { background: "#F8FAFC", border: "1px solid #E2E8F0", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.05)" }
    : { background: "rgba(15,23,42,0.7)", backdropFilter: "blur(12px)", border: "1px solid rgba(56,189,248,0.2)" };
  return (
    <div
      className={`absolute ${CORNER[corner]} max-w-[44%] sm:max-w-[36%] rounded-xl px-2.5 py-2 sm:px-3 sm:py-2.5 ${light ? "" : "shadow-lg"}`}
      style={cardStyle}
    >
      {accentChip ? (
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-[3px] text-[10px] sm:text-[11px] font-bold ${accentChip}`}>
          {icon} <span className="truncate">{value || "——"}</span>
        </span>
      ) : (
        <>
          <div className={`flex items-baseline gap-1 ${light ? "text-[#0F172A]" : "text-white"}`}>
            <span className="text-[14px] sm:text-[16px] font-bold font-display tabular-nums leading-none">{value || "——"}</span>
            {unit && <span className={`text-[9px] sm:text-[10px] font-semibold ${light ? "text-[#64748B]" : "text-white/60"}`}>{unit}</span>}
          </div>
          <div className={`flex items-center gap-1 mt-1 text-[9px] sm:text-[10px] font-semibold truncate ${light ? "text-[#64748B]" : "text-white/50"}`}>
            {icon}{label}
          </div>
        </>
      )}
    </div>
  );
}

export default function TelemetryHero({ power, energy, duration, status, statusColor, online, icons, theme }) {
  const vehicleState = !online ? "offline"
    : statusColor === "green" ? "charging"
    : statusColor === "yellow" ? "plugged"
    : statusColor === "red" ? "error"
    : "idle";
  const isLight = theme === "light";
  const meta = STATE_META[vehicleState];
  const chip = (isLight ? STATE_META_LIGHT[vehicleState] : meta).chip;
  const lineColor = isLight ? LIGHT_LINE_COLOR : meta.dot;
  const heroImage = isLight ? HERO_IMAGE_LIGHT : HERO_IMAGE_DARK;
  const connectors = isLight ? CONNECTORS_LIGHT : CONNECTORS_DARK;
  const Line = isLight ? LeaderLineOrganic : LeaderLine;

  return (
    <div className="relative mb-3" style={{ background: isLight ? "#ffffff" : "#0B0F17" }}>
      <style>{`
        @keyframes hud-flow-anim { to { stroke-dashoffset: -32; } }
        .hud-flow { animation: hud-flow-anim 1.4s linear infinite; }
        @keyframes hud-ping-anim {
          0%   { transform: scale(1); opacity: 0.7; }
          75%, 100% { transform: scale(2.6); opacity: 0; }
        }
        .hud-ping { animation: hud-ping-anim 1.8s cubic-bezier(0,0,0.2,1) infinite; transform-origin: center; transform-box: fill-box; }
      `}</style>

      {/* Açık temada araç/HUD alanı daha geniş — koyu temanın kompakt 560px'i
          beyaz kartın içinde küçük ve boşluklu kalıyordu. */}
      <div className="relative w-full mx-auto" style={{ aspectRatio: "1200/896", maxWidth: isLight ? 760 : 560 }}>
        {isLight ? null : <GroundGlow />}
        {isLight ? null : <ContactShadow />}
        <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-contain" />
        {/* Açık tema fotoğrafı opak olduğu için zemin gölgesi GÖRSELİN
            ÜSTÜNE, teker hizasına çiziliyor — aksi halde hiç görünmezdi. */}
        {isLight && <GroundShadowLight />}

        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
          {connectors.map((c, i) => (
            <Line key={c.id} c={c} color={lineColor} delay={i * 0.25} />
          ))}
          {connectors.map((c) => (
            <ContactPoint key={c.id} x={c.to.x} y={c.to.y} color={lineColor} />
          ))}
        </svg>

        <HudCard corner="tl" icon={icons.power} label="Çıkış Gücü" value={power} unit="kW" light={isLight} />
        <HudCard corner="tr" icon={icons.status} value={status} accentChip={chip} light={isLight} />
        <HudCard corner="bl" icon={icons.energy} label="Tüketilen Enerji" value={energy} unit="kWh" light={isLight} />
        <HudCard corner="br" icon={icons.duration} label="Şarj Süresi" value={duration} unit="dk" light={isLight} />
      </div>
    </div>
  );
}
