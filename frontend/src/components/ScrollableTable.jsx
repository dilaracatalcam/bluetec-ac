import { useRef, useState, useEffect, useCallback } from "react";

/*
  Native ::-webkit-scrollbar CSS'i iOS Safari'de hiç render edilmiyor
  (Apple bunu desteklemiyor) — bu yüzden mobilde scroll çalışsa da
  görünür bir çubuk çıkmıyor, kullanıcı "nereye kaydırdığını" göremiyor.

  Bu component tamamen kendi JS'imizle çizilen bir track+thumb kullanır,
  tarayıcının native scrollbar'ına bağımlı değildir — iOS/Android/masaüstü
  hepsinde aynı şekilde çalışır ve her zaman görünür.
*/
export default function ScrollableTable({ children, minWidth }) {
  const scrollRef = useRef(null);
  const trackRef = useRef(null);
  const dragging = useRef(false);
  const [thumb, setThumb] = useState({ widthPct: 100, leftPct: 0, needed: false });

  const update = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollWidth, clientWidth, scrollLeft } = el;
    const needed = scrollWidth > clientWidth + 1;
    const widthPct = Math.min(100, (clientWidth / scrollWidth) * 100);
    const maxScroll = scrollWidth - clientWidth;
    const leftPct = maxScroll > 0 ? (scrollLeft / maxScroll) * (100 - widthPct) : 0;
    setThumb({ widthPct, leftPct, needed });
  }, []);

  useEffect(() => {
    update();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    // İçerik (satırlar) değiştiğinde de yeniden hesapla
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      ro.disconnect();
    };
  }, [update]);

  const scrollToClientX = (clientX) => {
    const track = trackRef.current;
    const el = scrollRef.current;
    if (!track || !el) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    el.scrollLeft = ratio * (el.scrollWidth - el.clientWidth);
  };

  const handlePointerDown = (e) => {
    dragging.current = true;
    scrollToClientX(e.clientX);
  };

  useEffect(() => {
    const handleMove = (e) => { if (dragging.current) scrollToClientX(e.clientX); };
    const handleUp = () => { dragging.current = false; };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, []);

  return (
    <div>
      <div
        ref={scrollRef}
        className="overflow-x-auto"
        style={{ WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}
      >
        <div style={{ minWidth }}>{children}</div>
      </div>

      {thumb.needed && (
        <div
          ref={trackRef}
          onPointerDown={handlePointerDown}
          className="relative h-[6px] mx-3 my-1.5 rounded-full bg-[var(--bg-subtle)] cursor-pointer select-none touch-none"
        >
          <div
            className="absolute top-0 h-full rounded-full bg-[var(--border-strong)] pointer-events-none"
            style={{ width: `${thumb.widthPct}%`, left: `${thumb.leftPct}%` }}
          />
        </div>
      )}
    </div>
  );
}