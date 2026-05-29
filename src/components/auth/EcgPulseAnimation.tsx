import { useEffect, useRef } from "react";

export default function EcgPulseAnimation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let startTime: number | null = null;
    const CYCLE = 5000; // ms por ciclo completo

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    function drawExactaText(cx: number, baseY: number, fontSize: number, alpha: number) {
      if (alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";

      const font = `400 ${fontSize}px 'Playfair Display', Georgia, serif`;
      ctx.font = font;

      const wE = ctx.measureText("E").width;
      const wx = ctx.measureText("x").width;
      const wacta = ctx.measureText("acta").width;
      const totalW = wE + wx + wacta;
      let startX = cx - totalW / 2;

      ctx.fillStyle = "#ffffff";
      ctx.fillText("E", startX, baseY);
      startX += wE;

      ctx.fillStyle = "#C8A96E";
      ctx.fillText("x", startX, baseY);
      startX += wx;

      ctx.fillStyle = "#ffffff";
      ctx.fillText("acta", startX, baseY);

      ctx.restore();
    }

    // Gera pontos do traçado ECG normalizado (0..1 em x, amplitude em y)
    function ecgY(t: number): number {
      if (t < 0.12) return 0;
      if (t < 0.20) return -0.12 * Math.sin(((t - 0.12) / 0.08) * Math.PI); // onda P
      if (t < 0.28) return 0;
      if (t < 0.32) return 0.08 * ((t - 0.28) / 0.04);   // pré-Q
      if (t < 0.36) return 0.08 - 0.88 * ((t - 0.32) / 0.04); // Q→R pico
      if (t < 0.40) return -0.80 + 1.05 * ((t - 0.36) / 0.04); // R→S
      if (t < 0.44) return 0.25 - 0.25 * ((t - 0.40) / 0.04); // S→baseline
      if (t < 0.52) return 0; // segmento ST
      if (t < 0.68) return -0.28 * Math.sin(((t - 0.52) / 0.16) * Math.PI); // onda T
      return 0;
    }


    function draw(ts: number) {
      if (!startTime) startTime = ts;
      const elapsed = (ts - startTime) % CYCLE;
      const t = elapsed / CYCLE; // 0..1

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Grade de fundo sutil
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 0.5;
      const gridSize = Math.round(h / 12);
      for (let x = 0; x < w; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y < h; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      const midY = h * 0.5;
      const amp = h * 0.32;

      // --- FASE 1: traçado ECG (t: 0 → 0.52) ---
      const ecgEnd = 0.52;
      if (t < ecgEnd) {
        const progress = t / ecgEnd; // 0..1 dentro da fase

        ctx.beginPath();
        ctx.strokeStyle = "rgba(255,255,255,0.88)";
        ctx.lineWidth = 2;
        ctx.shadowColor = "rgba(255,255,255,0.5)";
        ctx.shadowBlur = 10;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        const maxX = progress * w;
        ctx.moveTo(0, midY);
        for (let px = 0; px <= maxX; px += 1.5) {
          const xt = px / w;
          ctx.lineTo(px, midY + ecgY(xt) * amp);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // ponto luminoso na ponta
        const dotX = maxX;
        const dotY = midY + ecgY(progress * 1.0) * amp;
        ctx.beginPath();
        ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.shadowColor = "rgba(255,255,255,0.6)";
        ctx.shadowBlur = 16;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // --- FASE 2: morph para checkmark dourado (t: 0.52 → 0.70) ---
      const morphStart = 0.52;
      const morphEnd = 0.70;
      if (t >= morphStart && t < morphEnd) {
        const mp = (t - morphStart) / (morphEnd - morphStart); // 0..1
        const ease = mp < 0.5 ? 2 * mp * mp : -1 + (4 - 2 * mp) * mp;

        // Traço ECG fade out
        const ecgAlpha = 1 - ease;
        if (ecgAlpha > 0) {
          ctx.globalAlpha = ecgAlpha;
          ctx.beginPath();
          ctx.strokeStyle = "rgba(255,255,255,0.88)";
          ctx.lineWidth = 2;
          ctx.moveTo(0, midY);
          for (let px = 0; px <= w; px += 1.5) {
            ctx.lineTo(px, midY + ecgY(px / w) * amp);
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        // Checkmark dourado aparece
        const cx = w / 2;
        const cy = midY;
        const sz = Math.min(w, h) * 0.18;
        const p1 = [cx - sz, cy + sz * 0.1];
        const p2 = [cx - sz * 0.15, cy + sz * 0.7];
        const p3 = [cx + sz, cy - sz * 0.55];

        const seg1 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
        const seg2 = Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
        const total = seg1 + seg2;
        const drawn = ease * total;

        ctx.beginPath();
        ctx.strokeStyle = "#C6A27C";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.shadowColor = "#C6A27C";
        ctx.shadowBlur = 14;

        ctx.moveTo(p1[0], p1[1]);
        if (drawn <= seg1) {
          const r = drawn / seg1;
          ctx.lineTo(p1[0] + (p2[0] - p1[0]) * r, p1[1] + (p2[1] - p1[1]) * r);
        } else {
          ctx.lineTo(p2[0], p2[1]);
          const r2 = Math.min(1, (drawn - seg1) / seg2);
          ctx.lineTo(p2[0] + (p3[0] - p2[0]) * r2, p2[1] + (p3[1] - p2[1]) * r2);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // --- FASE 3: checkmark completo + texto (t: 0.70 → 0.88) ---
      if (t >= morphEnd && t < 0.88) {
        const cx = w / 2;
        const cy = midY;
        const sz = Math.min(w, h) * 0.18;

        // Checkmark fixo
        ctx.beginPath();
        ctx.strokeStyle = "#C6A27C";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.shadowColor = "#C6A27C";
        ctx.shadowBlur = 12;
        ctx.moveTo(cx - sz, cy + sz * 0.1);
        ctx.lineTo(cx - sz * 0.15, cy + sz * 0.7);
        ctx.lineTo(cx + sz, cy - sz * 0.55);
        ctx.stroke();
        ctx.shadowBlur = 0;

        const textP = (t - morphEnd) / (0.88 - morphEnd);
        const textAlpha = Math.min(1, textP * 2);
        drawExactaText(cx, cy + sz * 1.5, Math.round(w * 0.075), textAlpha);
      }

      // --- FASE 4: fade out geral (t: 0.88 → 1.0) ---
      if (t >= 0.88) {
        const fadeP = (t - 0.88) / 0.12;
        const alpha = 1 - fadeP;
        const cx = w / 2;
        const cy = midY;
        const sz = Math.min(w, h) * 0.18;

        ctx.globalAlpha = alpha;

        ctx.beginPath();
        ctx.strokeStyle = "#C6A27C";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.moveTo(cx - sz, cy + sz * 0.1);
        ctx.lineTo(cx - sz * 0.15, cy + sz * 0.7);
        ctx.lineTo(cx + sz, cy - sz * 0.55);
        ctx.stroke();

        drawExactaText(cx, cy + sz * 1.5, Math.round(w * 0.075), alpha);

        ctx.globalAlpha = 1;
      }

      animId = requestAnimationFrame(draw);
    }

    document.fonts.ready.then(() => {
      animId = requestAnimationFrame(draw);
    });
    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      aria-hidden="true"
    />
  );
}
