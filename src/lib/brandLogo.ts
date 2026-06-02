/**
 * Logo Rede D'Or — utilidade para embarcar a marca em PDFs e outros
 * relatórios visuais, seguindo o Manual da Marca (2025):
 *  - Cor institucional: azul Rede D'Or #01498E
 *  - Versão monocromática branca permitida sobre fundos escuros
 *  - Área de proteção mínima ao redor do símbolo
 *
 * Em vez de manter um PNG no repositório, rasterizamos o SVG no
 * navegador sob demanda — assim mantemos a mesma marca em qualquer
 * resolução sem inflar o bundle.
 */

const LOGO_VIEWBOX = "0 0 1190.55 300.85";

const LOGO_PATHS = `
<path d="M930.69,18.32h28.15v29.04c0,11.71-1.8,19.44-5.41,23.19-3.74,3.91-10.47,6.75-20.26,6.75h-4.72v-13.73c4.5,0,7.85-1.02,10.02-3.04,2.16-2.03,3.18-5.96,3.03-11.82h-10.81v-30.39ZM877.05,79.11c3.58,12.42,5.37,24.69,5.37,36.71,0,18.86-3.01,38.57-9.07,59.14-11.43,38.93-30.22,69.36-56.38,91.34-17.17,14.53-36.81,21.83-58.95,21.83-7.72,0-14.72-.81-20.99-2.37-6.26-1.56-15.21-4.82-26.85-9.8-20.86,8.5-40.27,12.78-58.17,12.78-8.78,0-16.19-1.06-22.25-3.12-3.7-1.2-6.83-3.32-9.36-6.28-2.56-3.02-3.83-6.04-3.83-9.06,0-5.78,3.18-10.36,9.52-13.73,6.39-3.42,14.97-5.14,25.75-5.14,16.96,0,36.41,5.69,58.33,17.11,14.32-9.7,27.74-21.98,40.35-36.77,7.85-9.3,14.24-17.45,19.16-24.55,4.92-7.09,17.57-26.35,37.91-57.79,15.86-24.19,36.69-48.83,62.44-73.82-5.86-13.63-12.53-24.09-20.06-31.44-15.46-15.34-36.29-22.98-62.44-22.98-34.42,0-63.58,11.67-87.42,34.96-11.84,11.51-21.11,24.29-27.78,38.32-6.14,12.82-9.23,25.65-9.23,38.48s4.03,23.28,12.08,31.23c7.61,7.59,18.11,11.41,31.49,11.41,18.43,0,36.12-7.14,53.09-21.43,23.06-19.51,39.01-47.07,47.84-82.68l3.62,1.16c-3.5,22.93-10.94,43.15-22.37,60.7-11.67,17.81-26.07,31.08-43.24,39.68-12.28,6.19-25.01,9.26-38.16,9.26-17.37,0-30.67-5.84-39.86-17.51-8.18-10.31-12.24-22.98-12.24-37.92,0-19.12,5.57-37.82,16.67-56.18,11.43-18.71,26.57-33.15,45.36-43.31,18.83-10.16,39.79-15.23,62.89-15.23,30.72,0,54.96,9.05,72.77,27.11,7.4,7.49,14.44,18.15,21.11,32.03,14.85-13.12,28.92-23.38,42.26-30.83l1.3,4.88c-12.33,7.74-25.87,19.01-40.68,33.8M717.68,272.03c13.34,6.69,26.84,10.01,40.52,10.01,20.75,0,39.83-7.55,57.19-22.59,24.37-20.97,42.06-49.63,53.04-86.05,6.14-20.41,9.23-39.37,9.23-56.78,0-11.01-1.54-22.18-4.6-33.6-8.7,10.21-16.55,20.62-23.59,31.13-7.04,10.57-17.13,27.11-30.26,49.65-13.26,22.78-24.37,39.83-33.32,51.14-8.95,11.32-19.98,22.38-33.11,33.09-7.2,5.78-18.91,13.78-35.11,23.99M703.2,271.83c-19.61-9.3-36.9-13.93-51.95-13.93-8.17,0-14.76,1.16-19.85,3.52-5.08,2.36-7.65,5.38-7.65,9.05s2.68,6.45,8.09,8.76c5.41,2.26,12.25,3.42,20.5,3.42,16.31,0,33.28-3.62,50.85-10.81"/>
<path d="M111.46,216.13v-.65c10.09-1.83,17.23-5.35,21.47-10.55,4.78-5.64,7.15-17.41,7.15-35.36,0-16.55-3.23-28.47-9.73-35.75-7.39-8.15-21.54-12.24-42.43-12.24H8.5v161.55h31.02v-53.42h43.29c5.02,0,9.01.36,12.02,1.08,2.99.72,5.6,2.3,7.79,4.78,2.23,2.48,3.59,5.56,4.13,9.26.54,3.7.83,8.37.83,13.97v24.34h31.16v-29.91c0-12.06-1.94-21.21-5.82-27.42-4.84-5.53-12.02-8.76-21.47-9.66M104.39,196.96c-2.3,2.4-4.88,4.02-7.79,4.88-2.91.9-7.07,1.33-12.46,1.33h-44.62v-55.07h43.72c5.68,0,10.27.36,13.75,1.04,3.48.71,6.21,2.29,8.22,4.74,2.44,3.63,3.7,10.55,3.7,20.71,0,11.02-1.51,18.49-4.53,22.37"/>
<polygon points="162.91 121.57 162.91 283.12 274.27 283.12 274.27 256.59 193.92 256.59 193.92 213.76 269.74 213.76 269.74 188.56 193.92 188.56 193.92 148.1 273.84 148.1 273.84 121.57 162.91 121.57"/>
<path d="M430.78,144.61c-8.5-15.36-27.03-23.04-55.54-23.04h-77.76v161.55h83.97c5.49,0,11.34-.65,17.55-1.9,6.24-1.3,11.24-3.02,15.01-5.21,16.22-9.54,24.34-28.68,24.34-57.29v-34.46c0-16.98-2.51-30.19-7.57-39.63M407.12,203.67v10.91c0,14.83-2.08,25.17-6.24,31.02-3.09,4.52-6.57,7.47-10.49,8.86-3.87,1.4-8.94,2.12-15.15,2.12h-46.74v-108.49h44.59c10.37,0,18.01,1.36,22.94,4.05,4.92,2.73,7.97,6.61,9.22,11.59,1.26,5.03,1.87,12.28,1.87,21.83v18.09Z"/>
<polygon points="458.57 121.57 458.57 283.12 569.93 283.12 569.93 256.59 489.59 256.59 489.59 213.76 565.4 213.76 565.4 188.56 489.59 188.56 489.59 148.1 569.5 148.1 569.5 121.57 458.57 121.57"/>
<path d="M1153.43,216.13v-.65c10.09-1.83,17.23-5.35,21.47-10.55,4.78-5.64,7.15-17.41,7.15-35.36,0-16.55-3.23-28.47-9.73-35.75-7.39-8.15-21.54-12.24-42.43-12.24h-79.41v161.55h31.02v-53.42h43.29c5.02,0,9.01.36,12.02,1.08,2.98.72,5.6,2.3,7.79,4.78,2.22,2.48,3.59,5.56,4.13,9.26.53,3.7.82,8.37.82,13.97v24.34h31.16v-29.91c0-12.06-1.94-21.21-5.82-27.42-4.85-5.53-12.02-8.76-21.47-9.66M1146.36,196.96c-2.3,2.4-4.88,4.02-7.79,4.88-2.91.9-7.07,1.33-12.46,1.33h-44.62v-55.07h43.72c5.67,0,10.27.36,13.75,1.04,3.48.71,6.2,2.29,8.22,4.74,2.44,3.63,3.69,10.55,3.69,20.71,0,11.02-1.51,18.49-4.52,22.37"/>
<path d="M1023.36,144.61c-8.5-15.36-27.03-23.04-55.54-23.04h-15.08c-28.51,0-47.03,7.68-55.54,23.04-5.06,9.44-7.57,22.66-7.57,39.63v34.46c0,28.61,8.12,47.75,24.34,57.29,3.77,2.19,8.76,3.91,15.01,5.21,6.21,1.26,12.06,1.9,17.55,1.9h27.5c5.49,0,11.34-.65,17.55-1.9,6.24-1.3,11.24-3.02,15.01-5.21,16.22-9.54,24.34-28.68,24.34-57.29v-34.46c0-16.98-2.51-30.19-7.57-39.63ZM999.7,203.67v10.91c0,14.83-2.08,25.17-6.24,31.02-3.09,4.52-6.57,7.47-10.49,8.86-3.87,1.4-8.38,2.12-15.15,2.12h-15.08c-6.21,0-11.27-.72-15.15-2.12-3.91-1.4-7.4-4.34-10.49-8.86-4.16-5.85-6.24-16.19-6.24-31.02v-29.01c0-9.55.61-16.8,1.87-21.83,1.26-4.99,4.3-8.86,9.22-11.59,4.92-2.69,12.56-4.05,22.94-4.05h10.78c10.37,0,18.01,1.36,22.94,4.05,4.92,2.73,7.97,6.61,9.22,11.59,1.26,5.03,1.87,12.28,1.87,21.83v18.09Z"/>
`;

/** Cor institucional Rede D'Or, conforme manual da marca 2025. */
export const REDE_DOR_BRAND_BLUE = "#01498E";
export const REDE_DOR_BRAND_BLUE_RGB: [number, number, number] = [1, 73, 142];

export type LogoVariant = "brand" | "white";

const cache = new Map<string, string>();

/**
 * Rasteriza o logotipo Rede D'Or em PNG (base64 data URL) usando o
 * canvas do navegador. Ideal para embed em PDFs (jsPDF.addImage).
 *
 * @param variant "brand" usa o azul institucional; "white" usa branco
 *                (recomendado sobre fundos escuros, ex.: faixa do header)
 * @param pixelHeight altura desejada do PNG em pixels (largura é proporcional)
 */
export async function getRedeDOrLogoPng(
  variant: LogoVariant = "brand",
  pixelHeight = 120,
): Promise<{ dataUrl: string; width: number; height: number; aspect: number }> {
  const aspect = 1190.55 / 300.85; // viewBox ratio
  const pixelWidth = Math.round(pixelHeight * aspect);
  const cacheKey = `${variant}@${pixelHeight}`;
  const cached = cache.get(cacheKey);
  if (cached) return { dataUrl: cached, width: pixelWidth, height: pixelHeight, aspect };

  const fill = variant === "white" ? "#FFFFFF" : REDE_DOR_BRAND_BLUE;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LOGO_VIEWBOX}" fill="${fill}">` +
    `<g>${LOGO_PATHS}</g></svg>`;

  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = (e) => reject(e);
      el.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context indisponível");
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);
    ctx.drawImage(img, 0, 0, pixelWidth, pixelHeight);
    const dataUrl = canvas.toDataURL("image/png");
    cache.set(cacheKey, dataUrl);
    return { dataUrl, width: pixelWidth, height: pixelHeight, aspect };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Desenha a logo Rede D'Or no topo do PDF, respeitando margens
 * recomendadas pelo Manual da Marca (área de proteção ≈ altura do "O").
 * Retorna a coordenada Y onde o conteúdo pode começar.
 */
export async function drawReportHeader(
  doc: import("jspdf").jsPDF,
  opts: {
    title: string;
    subtitle?: string;
    marginX?: number;
    /** Altura útil da logo no PDF, em mm. */
    logoHeightMm?: number;
    variant?: LogoVariant;
    /** Se true, pinta uma faixa de cor (azul institucional) e usa logo branca. */
    filledBar?: boolean;
  },
): Promise<number> {
  const {
    title,
    subtitle,
    marginX = 12,
    logoHeightMm = 10,
    variant,
    filledBar = false,
  } = opts;

  const pageWidth = doc.internal.pageSize.getWidth();
  const effectiveVariant: LogoVariant = variant ?? (filledBar ? "white" : "brand");
  const logo = await getRedeDOrLogoPng(effectiveVariant, 160);
  const logoWidthMm = logoHeightMm * logo.aspect;

  const barHeight = logoHeightMm + 10;
  if (filledBar) {
    doc.setFillColor(...REDE_DOR_BRAND_BLUE_RGB);
    doc.rect(0, 0, pageWidth, barHeight, "F");
  }

  // Logo no canto superior esquerdo, respeitando margem
  doc.addImage(logo.dataUrl, "PNG", marginX, 6, logoWidthMm, logoHeightMm);

  // Título à direita do logo
  const titleX = marginX + logoWidthMm + 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(filledBar ? 255 : 17, filledBar ? 255 : 24, filledBar ? 255 : 39);
  const titleMaxW = pageWidth - titleX - marginX;
  const titleLines = doc.splitTextToSize(title, titleMaxW) as string[];
  doc.text(titleLines[0] ?? "", titleX, 12);

  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(filledBar ? 230 : 90, filledBar ? 230 : 90, filledBar ? 230 : 90);
    const subLines = doc.splitTextToSize(subtitle, titleMaxW) as string[];
    doc.text(subLines.slice(0, 2), titleX, 17);
  }

  // Linha sutil separando header do conteúdo (apenas se não houver faixa)
  if (!filledBar) {
    doc.setDrawColor(...REDE_DOR_BRAND_BLUE_RGB);
    doc.setLineWidth(0.4);
    doc.line(marginX, barHeight - 1, pageWidth - marginX, barHeight - 1);
  }

  // Reset cor de texto para o conteúdo seguinte
  doc.setTextColor(17, 24, 39);
  return barHeight + 4;
}
