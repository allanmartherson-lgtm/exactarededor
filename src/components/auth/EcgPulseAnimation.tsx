import { useEffect, useRef } from "react";

const LOGO_ASPECT = 1190.55 / 300.85;
const BIG_LOGO_H_FRAC = 0.13;
const SMALL_LOGO_H = 28;

const FINANCIAL_VALUES = [
  'R$ 1.240,00', 'R$ 890,50', 'R$ 3.100,00',
  'R$ 450,00',  'R$ 2.780,00', 'R$ 670,00',
  'R$ 1.900,00', 'R$ 320,50',
];

const REDE_DOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1190.55 300.85" fill="white"><g><path d="M930.69,18.32h28.15v29.04c0,11.71-1.8,19.44-5.41,23.19-3.74,3.91-10.47,6.75-20.26,6.75h-4.72v-13.73c4.5,0,7.85-1.02,10.02-3.04,2.16-2.03,3.18-5.96,3.03-11.82h-10.81v-30.39ZM877.05,79.11c3.58,12.42,5.37,24.69,5.37,36.71,0,18.86-3.01,38.57-9.07,59.14-11.43,38.93-30.22,69.36-56.38,91.34-17.17,14.53-36.81,21.83-58.95,21.83-7.72,0-14.72-.81-20.99-2.37-6.26-1.56-15.21-4.82-26.85-9.8-20.86,8.5-40.27,12.78-58.17,12.78-8.78,0-16.19-1.06-22.25-3.12-3.7-1.2-6.83-3.32-9.36-6.28-2.56-3.02-3.83-6.04-3.83-9.06,0-5.78,3.18-10.36,9.52-13.73,6.39-3.42,14.97-5.14,25.75-5.14,16.96,0,36.41,5.69,58.33,17.11,14.32-9.7,27.74-21.98,40.35-36.77,7.85-9.3,14.24-17.45,19.16-24.55,4.92-7.09,17.57-26.35,37.91-57.79,15.86-24.19,36.69-48.83,62.44-73.82-5.86-13.63-12.53-24.09-20.06-31.44-15.46-15.34-36.29-22.98-62.44-22.98-34.42,0-63.58,11.67-87.42,34.96-11.84,11.51-21.11,24.29-27.78,38.32-6.14,12.82-9.23,25.65-9.23,38.48s4.03,23.28,12.08,31.23c7.61,7.59,18.11,11.41,31.49,11.41,18.43,0,36.12-7.14,53.09-21.43,23.06-19.51,39.01-47.07,47.84-82.68l3.62,1.16c-3.5,22.93-10.94,43.15-22.37,60.7-11.67,17.81-26.07,31.08-43.24,39.68-12.28,6.19-25.01,9.26-38.16,9.26-17.37,0-30.67-5.84-39.86-17.51-8.18-10.31-12.24-22.98-12.24-37.92,0-19.12,5.57-37.82,16.67-56.18,11.43-18.71,26.57-33.15,45.36-43.31,18.83-10.16,39.79-15.23,62.89-15.23,30.72,0,54.96,9.05,72.77,27.11,7.4,7.49,14.44,18.15,21.11,32.03,14.85-13.12,28.92-23.38,42.26-30.83l1.3,4.88c-12.33,7.74-25.87,19.01-40.68,33.8M717.68,272.03c13.34,6.69,26.84,10.01,40.52,10.01,20.75,0,39.83-7.55,57.19-22.59,24.37-20.97,42.06-49.63,53.04-86.05,6.14-20.41,9.23-39.37,9.23-56.78,0-11.01-1.54-22.18-4.6-33.6-8.7,10.21-16.55,20.62-23.59,31.13-7.04,10.57-17.13,27.11-30.26,49.65-13.26,22.78-24.37,39.83-33.32,51.14-8.95,11.32-19.98,22.38-33.11,33.09-7.2,5.78-18.91,13.78-35.11,23.99M703.2,271.83c-19.61-9.3-36.9-13.93-51.95-13.93-8.17,0-14.76,1.16-19.85,3.52-5.08,2.36-7.65,5.38-7.65,9.05s2.68,6.45,8.09,8.76c5.41,2.26,12.25,3.42,20.5,3.42,16.31,0,33.28-3.62,50.85-10.81"/><path d="M111.46,216.13v-.65c10.09-1.83,17.23-5.35,21.47-10.55,4.78-5.64,7.15-17.41,7.15-35.36,0-16.55-3.23-28.47-9.73-35.75-7.39-8.15-21.54-12.24-42.43-12.24H8.5v161.55h31.02v-53.42h43.29c5.02,0,9.01.36,12.02,1.08,2.99.72,5.6,2.3,7.79,4.78,2.23,2.48,3.59,5.56,4.13,9.26.54,3.7.83,8.37.83,13.97v24.34h31.16v-29.91c0-12.06-1.94-21.21-5.82-27.42-4.84-5.53-12.02-8.76-21.47-9.66M104.39,196.96c-2.3,2.4-4.88,4.02-7.79,4.88-2.91.9-7.07,1.33-12.46,1.33h-44.62v-55.07h43.72c5.68,0,10.27.36,13.75,1.04,3.48.71,6.21,2.29,8.22,4.74,2.44,3.63,3.7,10.55,3.7,20.71,0,11.02-1.51,18.49-4.53,22.37"/></g><polygon points="162.91 121.57 162.91 283.12 274.27 283.12 274.27 256.59 193.92 256.59 193.92 213.76 269.74 213.76 269.74 188.56 193.92 188.56 193.92 148.1 273.84 148.1 273.84 121.57 162.91 121.57"/><path d="M430.78,144.61c-8.5-15.36-27.03-23.04-55.54-23.04h-77.76v161.55h83.97c5.49,0,11.34-.65,17.55-1.9,6.24-1.3,11.24-3.02,15.01-5.21,16.22-9.54,24.34-28.68,24.34-57.29v-34.46c0-16.98-2.51-30.19-7.57-39.63M407.12,203.67v10.91c0,14.83-2.08,25.17-6.24,31.02-3.09,4.52-6.57,7.47-10.49,8.86-3.87,1.4-8.94,2.12-15.15,2.12h-46.74v-108.49h44.59c10.37,0,18.01,1.36,22.94,4.05,4.92,2.73,7.97,6.61,9.22,11.59,1.26,5.03,1.87,12.28,1.87,21.83v18.09Z"/><polygon points="458.57 121.57 458.57 283.12 569.93 283.12 569.93 256.59 489.59 256.59 489.59 213.76 565.4 213.76 565.4 188.56 489.59 188.56 489.59 148.1 569.5 148.1 569.5 121.57 458.57 121.57"/><path d="M1153.43,216.13v-.65c10.09-1.83,17.23-5.35,21.47-10.55,4.78-5.64,7.15-17.41,7.15-35.36,0-16.55-3.23-28.47-9.73-35.75-7.39-8.15-21.54-12.24-42.43-12.24h-79.41v161.55h31.02v-53.42h43.29c5.02,0,9.01.36,12.02,1.08,2.98.72,5.6,2.3,7.79,4.78,2.22,2.48,3.59,5.56,4.13,9.26.53,3.7.82,8.37.82,13.97v24.34h31.16v-29.91c0-12.06-1.94-21.21-5.82-27.42-4.85-5.53-12.02-8.76-21.47-9.66M1146.36,196.96c-2.3,2.4-4.88,4.02-7.79,4.88-2.91.9-7.07,1.33-12.46,1.33h-44.62v-55.07h43.72c5.67,0,10.27.36,13.75,1.04,3.48.71,6.2,2.29,8.22,4.74,2.44,3.63,3.69,10.55,3.69,20.71,0,11.02-1.51,18.49-4.52,22.37"/><path d="M1023.36,144.61c-8.5-15.36-27.03-23.04-55.54-23.04h-15.08c-28.51,0-47.03,7.68-55.54,23.04-5.06,9.44-7.57,22.66-7.57,39.63v34.46c0,28.61,8.12,47.75,24.34,57.29,3.77,2.19,8.76,3.91,15.01,5.21,6.21,1.26,12.06,1.9,17.55,1.9h27.5c5.49,0,11.34-.65,17.55-1.9,6.24-1.3,11.24-3.02,15.01-5.21,16.22-9.54,24.34-28.68,24.34-57.29v-34.46c0-16.98-2.51-30.19-7.57-39.63ZM999.7,203.67v10.91c0,14.83-2.08,25.17-6.24,31.02-3.09,4.52-6.57,7.47-10.49,8.86-3.87,1.4-8.38,2.12-15.15,2.12h-15.08c-6.21,0-11.27-.72-15.15-2.12-3.91-1.4-7.4-4.34-10.49-8.86-4.16-5.85-6.24-16.19-6.24-31.02v-29.01c0-9.55.61-16.8,1.87-21.83,1.26-4.99,4.3-8.86,9.22-11.59,4.92-2.69,12.56-4.05,22.94-4.05h10.78c10.37,0,18.01,1.36,22.94,4.05,4.92,2.73,7.97,6.61,9.22,11.59,1.26,5.03,1.87,12.28,1.87,21.83v18.09Z"/></svg>`;

export default function EcgPulseAnimation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let startTime: number | null = null;
    let stopped = false;

    // ── Partículas financeiras ────────────────────────────
    interface Particle {
      label: string;
      xFrac: number;
      yOffset: number;
      floatAmp: number;
      floatSpeed: number;
      floatPhase: number;
      fontSize: number;
      spawnAt: number;
      mergeAt: number;
    }

    const particles: Particle[] = FINANCIAL_VALUES.map((label, i) => {
      const xFrac = 0.07 + i * 0.115 + (Math.random() * 0.03 - 0.015);
      return {
        label,
        xFrac,
        yOffset: (i % 2 === 0 ? -1 : 1) * (0.14 + Math.random() * 0.08),
        floatAmp: 0.010 + Math.random() * 0.008,
        floatSpeed: 0.6 + Math.random() * 0.5,
        floatPhase: Math.random() * Math.PI * 2,
        fontSize: 0.026 + Math.random() * 0.007,
        spawnAt: Math.max(0, xFrac - 0.22),
        mergeAt: xFrac,
      };
    });


    // ── Logo preload ──────────────────────────────────────
    const rdorImg = new Image();
    let rdorImgLoaded = false;
    const svgBlob = new Blob([REDE_DOR_SVG], { type: "image/svg+xml" });
    const svgUrl = URL.createObjectURL(svgBlob);
    rdorImg.onload = () => { rdorImgLoaded = true; URL.revokeObjectURL(svgUrl); };
    rdorImg.src = svgUrl;

    // ── Helpers ───────────────────────────────────────────
    function easeOut(t: number) { return 1 - Math.pow(1 - t, 3); }
    function easeInOut(t: number) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }

    function drawRedeDOrLogo(cx: number, cy: number, logoH: number, alpha: number) {
      if (!rdorImgLoaded || alpha <= 0) return;
      const logoW = logoH * LOGO_ASPECT;
      ctx.globalAlpha = alpha;
      ctx.drawImage(rdorImg, cx - logoW / 2, cy - logoH / 2, logoW, logoH);
      ctx.globalAlpha = 1;
    }

    function drawSubtitle(cx: number, cy: number, fontSize: number, alpha: number) {
      if (alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "white";
      ctx.font = `400 ${fontSize}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Hospital DF Star", cx, cy);
      ctx.restore();
    }

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      if (stopped) {
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        const bigLogoH = h * BIG_LOGO_H_FRAC;
        drawRedeDOrLogo(w / 2, h / 2, bigLogoH, 0.9);
        drawSubtitle(w / 2, h / 2 + bigLogoH * 0.9, Math.round(h * 0.02), 0.45);
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // ── ECG waveform ──────────────────────────────────────
    function ecgY(t: number): number {
      if (t < 0.12) return 0;
      if (t < 0.20) return -0.12 * Math.sin(((t - 0.12) / 0.08) * Math.PI);
      if (t < 0.28) return 0;
      if (t < 0.32) return 0.08 * ((t - 0.28) / 0.04);
      if (t < 0.36) return 0.08 - 0.88 * ((t - 0.32) / 0.04);
      if (t < 0.40) return -0.80 + 1.05 * ((t - 0.36) / 0.04);
      if (t < 0.44) return 0.25 - 0.25 * ((t - 0.40) / 0.04);
      if (t < 0.52) return 0;
      if (t < 0.68) return -0.28 * Math.sin(((t - 0.52) / 0.16) * Math.PI);
      return 0;
    }




    // ── Exacta text ───────────────────────────────────────
    function drawExactaText(cx: number, baseY: number, fontSize: number, alpha: number) {
      if (alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.font = `400 ${fontSize}px 'Playfair Display', Georgia, serif`;
      const wE = ctx.measureText("E").width;
      const wx = ctx.measureText("x").width;
      const wacta = ctx.measureText("acta").width;
      const totalW = wE + wx + wacta;
      let sx = cx - totalW / 2;
      ctx.fillStyle = "#ffffff"; ctx.fillText("E", sx, baseY); sx += wE;
      ctx.fillStyle = "#C8A96E"; ctx.fillText("x", sx, baseY); sx += wx;
      ctx.fillStyle = "#ffffff"; ctx.fillText("acta", sx, baseY);
      ctx.restore();
    }

    // ── Phase timings (ms) ────────────────────────────────
    const T_ECG_END    = 9000;
    const T_MORPH_END  = 10500;
    const T_EXACTA_END = 13500;
    const T_RISE_END   = 16000;

    function drawParticles(ecgProgress: number, elapsed: number) {
      const w = canvas.width;
      const h = canvas.height;
      const midY = h * 0.5;
      const amp  = h * 0.30;

      particles.forEach(p => {
        if (ecgProgress < p.spawnAt) return;

        const px        = p.xFrac * w;
        const lineY     = midY + ecgY(p.xFrac) * amp;
        const startY    = midY + p.yOffset * h;

        const driftRange = Math.max(0.01, p.mergeAt - p.spawnAt);
        const driftRaw   = (ecgProgress - p.spawnAt) / driftRange;
        const driftP     = Math.min(1, Math.max(0, driftRaw));
        const driftEased = driftP < 0.5
          ? 2 * driftP * driftP
          : -1 + (4 - 2 * driftP) * driftP;

        const MERGE_DUR = 0.12;
        const mergeRaw  = (ecgProgress - p.mergeAt) / MERGE_DUR;
        const mergeP    = Math.min(1, Math.max(0, mergeRaw));
        const mergeEased = mergeP < 0.5
          ? 2 * mergeP * mergeP
          : -1 + (4 - 2 * mergeP) * mergeP;

        if (mergeP >= 1) return;

        const floatY = Math.sin(elapsed * 0.001 * p.floatSpeed + p.floatPhase)
                       * p.floatAmp * h
                       * (1 - mergeEased);

        const driftY = startY + floatY + (lineY - startY) * driftEased;
        const curY   = driftP < 1 ? driftY : lineY + floatY;

        const fadeInA  = Math.min(1, driftP / 0.2);
        const mergeOutA = mergeP > 0.7 ? 1 - (mergeP - 0.7) / 0.3 : 1;
        const alpha    = fadeInA * mergeOutA * 0.88;
        if (alpha <= 0.01) return;

        const r = Math.round(198 + (255 - 198) * mergeEased);
        const g = Math.round(162 + (255 - 162) * mergeEased);
        const b = Math.round(124 + (255 - 124) * mergeEased);

        const scaleX = 1 + mergeEased * 0.3;
        const scaleY = Math.max(0.02, 1 - mergeEased * 0.98);

        const blur = mergeEased * 3;

        ctx.save();
        ctx.translate(px, curY);
        ctx.scale(scaleX, scaleY);
        if (blur > 0.4) ctx.filter = `blur(${blur.toFixed(1)}px)`;
        ctx.globalAlpha = alpha;
        ctx.fillStyle   = `rgba(${r},${g},${b},1)`;
        ctx.font        = `500 ${Math.round(p.fontSize * h)}px system-ui`;
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.label, 0, 0);
        ctx.filter  = 'none';
        ctx.restore();

        if (mergeP > 0.1 && mergeP < 0.9) {
          const pulseA = Math.sin(((mergeP - 0.1) / 0.8) * Math.PI) * 0.6;
          const pulseW = 8 + mergeEased * 10;
          ctx.save();
          ctx.globalAlpha = pulseA;
          ctx.strokeStyle = `rgba(${r},${g},${b},1)`;
          ctx.lineWidth   = 2 + mergeEased * 2;
          ctx.lineCap     = 'round';
          ctx.shadowColor = 'white';
          ctx.shadowBlur  = 10 * pulseA;
          ctx.beginPath();
          ctx.moveTo(px - pulseW, lineY);
          ctx.lineTo(px + pulseW, lineY);
          ctx.stroke();
          ctx.restore();
        }
      });
    }

    // ── Main draw loop ────────────────────────────────────
    function draw(ts: number) {
      if (stopped) return;
      if (!startTime) startTime = ts;
      const elapsed = ts - startTime;
      const w = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, w, h);

      // Grid
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 0.5;
      const gs = Math.round(h / 12);
      for (let x2 = 0; x2 < w; x2 += gs) { ctx.beginPath(); ctx.moveTo(x2, 0); ctx.lineTo(x2, h); ctx.stroke(); }
      for (let y2 = 0; y2 < h; y2 += gs) { ctx.beginPath(); ctx.moveTo(0, y2); ctx.lineTo(w, y2); ctx.stroke(); }

      const midY = h * 0.5;
      const amp = h * 0.30;
      
      const bigLogoH = h * BIG_LOGO_H_FRAC;
      const slW = SMALL_LOGO_H * LOGO_ASPECT;
      const slCX = 32 + slW / 2;
      const slCY = h - 32 - SMALL_LOGO_H / 2;

      // ── FASE 1: ECG ──────────────────────────────────
      if (elapsed < T_ECG_END) {
        const progress = elapsed / T_ECG_END;
        const maxX = progress * w;

        ctx.beginPath();
        ctx.strokeStyle = "rgba(255,255,255,0.88)";
        ctx.lineWidth = 2;
        ctx.shadowColor = "rgba(255,255,255,0.4)";
        ctx.shadowBlur = 8;
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.moveTo(0, midY);
        for (let px = 0; px <= maxX; px += 1.5) ctx.lineTo(px, midY + ecgY(px / w) * amp);
        ctx.stroke(); ctx.shadowBlur = 0;

        ctx.beginPath();
        ctx.arc(maxX, midY + ecgY(progress) * amp, 4, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.shadowColor = "rgba(255,255,255,0.6)"; ctx.shadowBlur = 14;
        ctx.fill(); ctx.shadowBlur = 0;

        // Partículas financeiras
        drawParticles(progress, elapsed);
      }


      // ── FASE 2: Morph ────────────────────────────────
      if (elapsed >= T_ECG_END && elapsed < T_MORPH_END) {
        const mp = (elapsed - T_ECG_END) / (T_MORPH_END - T_ECG_END);
        const ease = easeInOut(mp);

        ctx.globalAlpha = Math.max(0, 1 - ease * 1.5);
        ctx.beginPath(); ctx.strokeStyle = "rgba(255,255,255,0.88)"; ctx.lineWidth = 2;
        ctx.moveTo(0, midY);
        for (let px = 0; px <= w; px += 1.5) ctx.lineTo(px, midY + ecgY(px / w) * amp);
        ctx.stroke(); ctx.globalAlpha = 1;

        

        const cx2 = w / 2, cy2 = midY, sz = Math.min(w, h) * 0.18;
        const p1 = [cx2 - sz, cy2 + sz * 0.1], p2 = [cx2 - sz * 0.15, cy2 + sz * 0.7], p3 = [cx2 + sz, cy2 - sz * 0.55];
        const s1 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), s2 = Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
        const drawn = ease * (s1 + s2);
        ctx.beginPath(); ctx.strokeStyle = "#C6A27C"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.shadowColor = "#C6A27C"; ctx.shadowBlur = 14;
        ctx.moveTo(p1[0], p1[1]);
        if (drawn <= s1) { const r = drawn / s1; ctx.lineTo(p1[0] + (p2[0] - p1[0]) * r, p1[1] + (p2[1] - p1[1]) * r); }
        else { ctx.lineTo(p2[0], p2[1]); const r2 = Math.min(1, (drawn - s1) / s2); ctx.lineTo(p2[0] + (p3[0] - p2[0]) * r2, p2[1] + (p3[1] - p2[1]) * r2); }
        ctx.stroke(); ctx.shadowBlur = 0;

      }

      // ── FASE 3: Exacta ───────────────────────────────
      if (elapsed >= T_MORPH_END && elapsed < T_EXACTA_END) {
        const p = (elapsed - T_MORPH_END) / (T_EXACTA_END - T_MORPH_END);
        const checkAlpha = p > 0.75 ? Math.max(0, 1 - (p - 0.75) / 0.25) : 1;
        const textAlpha = p < 0.15 ? p / 0.15 : p > 0.75 ? Math.max(0, 1 - (p - 0.75) / 0.25) : 1;
        const cornerLogoAlpha = p > 0.75 ? Math.max(0, 1 - (p - 0.75) / 0.25) : 0.85;

        const cx3 = w / 2, cy3 = midY, sz = Math.min(w, h) * 0.18;
        if (checkAlpha > 0) {
          ctx.globalAlpha = checkAlpha;
          ctx.beginPath(); ctx.strokeStyle = "#C6A27C"; ctx.lineWidth = 3;
          ctx.lineCap = "round"; ctx.lineJoin = "round";
          ctx.shadowColor = "#C6A27C"; ctx.shadowBlur = 12;
          ctx.moveTo(cx3 - sz, cy3 + sz * 0.1); ctx.lineTo(cx3 - sz * 0.15, cy3 + sz * 0.7); ctx.lineTo(cx3 + sz, cy3 - sz * 0.55);
          ctx.stroke(); ctx.shadowBlur = 0; ctx.globalAlpha = 1;
        }
        drawExactaText(cx3, cy3 + sz * 1.5, Math.round(w * 0.075), textAlpha);
        drawRedeDOrLogo(slCX, slCY, SMALL_LOGO_H, cornerLogoAlpha);
        drawSubtitle(slCX, slCY + SMALL_LOGO_H / 2 + 14, Math.round(h * 0.019), cornerLogoAlpha * 0.4);
      }

      // ── FASE 4: Rede D'Or sobe ────────────────────────
      if (elapsed >= T_EXACTA_END && elapsed < T_RISE_END) {
        const p = (elapsed - T_EXACTA_END) / (T_RISE_END - T_EXACTA_END);
        const ease = easeOut(p);
        const curCX = slCX + (w / 2 - slCX) * ease;
        const curCY = slCY + (h / 2 - slCY) * ease;
        const curH = SMALL_LOGO_H + (bigLogoH - SMALL_LOGO_H) * ease;
        drawRedeDOrLogo(curCX, curCY, curH, 0.9);
        if (p > 0.7) {
          const subA = (p - 0.7) / 0.3;
          drawSubtitle(w / 2, h / 2 + bigLogoH * 0.9, Math.round(h * 0.02), subA * 0.45);
        }
      }

      // ── FASE 5: Fixo no centro — para o loop ──────────
      if (elapsed >= T_RISE_END) {
        stopped = true;
        drawRedeDOrLogo(w / 2, h / 2, bigLogoH, 0.9);
        drawSubtitle(w / 2, h / 2 + bigLogoH * 0.9, Math.round(h * 0.02), 0.45);
        return;
      }

      animId = requestAnimationFrame(draw);
    }

    document.fonts.ready.then(() => {
      animId = requestAnimationFrame(draw);
    });

    return () => {
      stopped = true;
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
