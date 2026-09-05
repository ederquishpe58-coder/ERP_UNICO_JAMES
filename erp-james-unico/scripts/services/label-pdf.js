(function(){
  const BlessERP = window.BlessERP = window.BlessERP || {};

  const MM_TO_PT = 72 / 25.4;
  const BOX_PAGE_MM = Object.freeze({ width: 100, height: 160 });
  const BUNCH_PAGE_MM = Object.freeze({ width: 76.2, height: 58 });
  const BUNCH_BOTTOM_CLEARANCE_MM = 20;
  const BUNCH_CONTENT_SCALE = 0.8;
  const BUNCH_BARCODE_SCALE = 0.9;
  const BOX_LABEL_YIELD_INTERVAL = 24;
  const barcodePatternCache = new Map();

  function mmToPt(value) {
    return Number(value || 0) * MM_TO_PT;
  }

  function ascii(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7E]/g, "?");
  }

  function pdfEscape(value) {
    return ascii(value).replace(/([\\()])/g, "\\$1");
  }

  function cleanFileToken(value) {
    return ascii(value)
      .replace(/[^0-9A-Z_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "ETIQUETAS";
  }

  function byteLength(value) {
    return String(value).length;
  }

  function toBytes(value) {
    const source = String(value);
    const bytes = new Uint8Array(source.length);
    for (let index = 0; index < source.length; index += 1) {
      bytes[index] = source.charCodeAt(index) & 0xff;
    }
    return bytes;
  }

  function createPdf(pages) {
    if (!Array.isArray(pages) || !pages.length) {
      throw new Error("No hay paginas para crear el PDF.");
    }

    const objects = [];
    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    objects[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>";

    const pageIds = [];
    pages.forEach((page, index) => {
      const contentId = 6 + (index * 2);
      const pageId = contentId + 1;
      const content = String(page.content || "");
      pageIds.push(pageId);
      objects[contentId] = `<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`;
      objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${Number(page.width).toFixed(3)} ${Number(page.height).toFixed(3)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentId} 0 R >>`;
    });
    objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

    let output = "%PDF-1.4\n% BLESS FLOWER LABEL PDF\n";
    const offsets = [0];
    for (let id = 1; id < objects.length; id += 1) {
      offsets[id] = byteLength(output);
      output += `${id} 0 obj\n${objects[id]}\nendobj\n`;
    }

    const xrefOffset = byteLength(output);
    output += `xref\n0 ${objects.length}\n`;
    output += "0000000000 65535 f \n";
    for (let id = 1; id < objects.length; id += 1) {
      output += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
    }
    output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return toBytes(output);
  }

  function estimateTextWidth(text, fontSize, bold = false) {
    return ascii(text).length * Number(fontSize || 0) * (bold ? 0.56 : 0.52);
  }

  function fitText(text, maxWidth, fontSize, minimum = 4.5, bold = false) {
    const source = ascii(text);
    let size = Number(fontSize || 8);
    while (size > minimum && estimateTextWidth(source, size, bold) > maxWidth) {
      size -= 0.25;
    }
    if (estimateTextWidth(source, size, bold) <= maxWidth) {
      return { text: source, size };
    }
    const average = Math.max(1, size * (bold ? 0.56 : 0.52));
    const maximumCharacters = Math.max(3, Math.floor(maxWidth / average));
    return {
      text: source.length > maximumCharacters ? `${source.slice(0, Math.max(1, maximumCharacters - 3))}...` : source,
      size
    };
  }

  function textCommand(pageHeight, value, x, top, options = {}) {
    const bold = options.bold === true;
    const fontCode = options.font === "serif" ? "F3" : (bold ? "F2" : "F1");
    const color = Array.isArray(options.color) && options.color.length === 3
      ? options.color.map(channel => Math.min(1, Math.max(0, Number(channel || 0))).toFixed(3)).join(" ")
      : "0";
    const fitted = fitText(
      value,
      Number(options.maxWidth || 100000),
      Number(options.size || 8),
      Number(options.minimumSize || 4.5),
      bold
    );
    let outputX = Number(x || 0);
    if (options.align === "center") {
      outputX += (Number(options.maxWidth || 0) - estimateTextWidth(fitted.text, fitted.size, bold)) / 2;
    } else if (options.align === "right") {
      outputX += Number(options.maxWidth || 0) - estimateTextWidth(fitted.text, fitted.size, bold);
    }
    const baseline = pageHeight - Number(top || 0) - fitted.size;
    return `BT /${fontCode} ${fitted.size.toFixed(2)} Tf ${color} ${color === "0" ? "g" : "rg"} 1 0 0 1 ${outputX.toFixed(3)} ${baseline.toFixed(3)} Tm (${pdfEscape(fitted.text)}) Tj ET\n`;
  }

  function lineCommand(pageHeight, x1, top1, x2, top2, width = 0.7) {
    return `${Number(width).toFixed(2)} w ${Number(x1).toFixed(3)} ${(pageHeight - Number(top1)).toFixed(3)} m ${Number(x2).toFixed(3)} ${(pageHeight - Number(top2)).toFixed(3)} l S\n`;
  }

  function curveCommand(pageHeight, start, control1, control2, end, width = 0.7) {
    return `${Number(width).toFixed(2)} w `
      + `${Number(start.x).toFixed(3)} ${(pageHeight - Number(start.top)).toFixed(3)} m `
      + `${Number(control1.x).toFixed(3)} ${(pageHeight - Number(control1.top)).toFixed(3)} `
      + `${Number(control2.x).toFixed(3)} ${(pageHeight - Number(control2.top)).toFixed(3)} `
      + `${Number(end.x).toFixed(3)} ${(pageHeight - Number(end.top)).toFixed(3)} c S\n`;
  }

  function circleCommand(pageHeight, centerX, centerTop, radius) {
    const centerY = pageHeight - Number(centerTop);
    const r = Number(radius);
    const control = r * 0.5522847498;
    return `0 g ${(Number(centerX) + r).toFixed(3)} ${centerY.toFixed(3)} m `
      + `${(Number(centerX) + r).toFixed(3)} ${(centerY + control).toFixed(3)} `
      + `${(Number(centerX) + control).toFixed(3)} ${(centerY + r).toFixed(3)} `
      + `${Number(centerX).toFixed(3)} ${(centerY + r).toFixed(3)} c `
      + `${(Number(centerX) - control).toFixed(3)} ${(centerY + r).toFixed(3)} `
      + `${(Number(centerX) - r).toFixed(3)} ${(centerY + control).toFixed(3)} `
      + `${(Number(centerX) - r).toFixed(3)} ${centerY.toFixed(3)} c `
      + `${(Number(centerX) - r).toFixed(3)} ${(centerY - control).toFixed(3)} `
      + `${(Number(centerX) - control).toFixed(3)} ${(centerY - r).toFixed(3)} `
      + `${Number(centerX).toFixed(3)} ${(centerY - r).toFixed(3)} c `
      + `${(Number(centerX) + control).toFixed(3)} ${(centerY - r).toFixed(3)} `
      + `${(Number(centerX) + r).toFixed(3)} ${(centerY - control).toFixed(3)} `
      + `${(Number(centerX) + r).toFixed(3)} ${centerY.toFixed(3)} c f\n`;
  }

  function filledPathCommand(pageHeight, color, operations = []) {
    const rgb = color
      .map(channel => Math.min(1, Math.max(0, Number(channel || 0))).toFixed(3))
      .join(" ");
    const path = operations.map(operation => {
      if (operation.type === "M" || operation.type === "L") {
        return `${Number(operation.x).toFixed(3)} ${(pageHeight - Number(operation.top)).toFixed(3)} ${operation.type.toLowerCase()}`;
      }
      if (operation.type === "C") {
        return `${Number(operation.x1).toFixed(3)} ${(pageHeight - Number(operation.top1)).toFixed(3)} `
          + `${Number(operation.x2).toFixed(3)} ${(pageHeight - Number(operation.top2)).toFixed(3)} `
          + `${Number(operation.x).toFixed(3)} ${(pageHeight - Number(operation.top)).toFixed(3)} c`;
      }
      return "";
    }).filter(Boolean).join(" ");
    return `${rgb} rg ${path} h f\n`;
  }

  function ellipseCommand(pageHeight, centerX, centerTop, radiusX, radiusY, color) {
    const centerY = pageHeight - Number(centerTop);
    const rx = Number(radiusX);
    const ry = Number(radiusY);
    const controlX = rx * 0.5522847498;
    const controlY = ry * 0.5522847498;
    const rgb = color
      .map(channel => Math.min(1, Math.max(0, Number(channel || 0))).toFixed(3))
      .join(" ");
    return `${rgb} rg ${(Number(centerX) + rx).toFixed(3)} ${centerY.toFixed(3)} m `
      + `${(Number(centerX) + rx).toFixed(3)} ${(centerY + controlY).toFixed(3)} `
      + `${(Number(centerX) + controlX).toFixed(3)} ${(centerY + ry).toFixed(3)} `
      + `${Number(centerX).toFixed(3)} ${(centerY + ry).toFixed(3)} c `
      + `${(Number(centerX) - controlX).toFixed(3)} ${(centerY + ry).toFixed(3)} `
      + `${(Number(centerX) - rx).toFixed(3)} ${(centerY + controlY).toFixed(3)} `
      + `${(Number(centerX) - rx).toFixed(3)} ${centerY.toFixed(3)} c `
      + `${(Number(centerX) - rx).toFixed(3)} ${(centerY - controlY).toFixed(3)} `
      + `${(Number(centerX) - controlX).toFixed(3)} ${(centerY - ry).toFixed(3)} `
      + `${Number(centerX).toFixed(3)} ${(centerY - ry).toFixed(3)} c `
      + `${(Number(centerX) + controlX).toFixed(3)} ${(centerY - ry).toFixed(3)} `
      + `${(Number(centerX) + rx).toFixed(3)} ${(centerY - controlY).toFixed(3)} `
      + `${(Number(centerX) + rx).toFixed(3)} ${centerY.toFixed(3)} c f\n`;
  }

  function aduanaLogoCommand(pageHeight, centerX, top) {
    const blockWidth = mmToPt(50);
    const startX = Number(centerX) - (blockWidth / 2);
    const iconLeft = startX;
    const textLeft = startX + mmToPt(15);
    const textWidth = mmToPt(35);
    const blue = [0, 0.47, 0.73];
    const red = [0.95, 0.08, 0.14];
    const yellow = [1, 0.72, 0.1];
    let content = "";

    content += filledPathCommand(pageHeight, blue, [
      { type: "M", x: iconLeft + mmToPt(5.8), top },
      { type: "C", x1: iconLeft + mmToPt(1.1), top1: top + mmToPt(4), x2: iconLeft + mmToPt(1.5), top2: top + mmToPt(8.5), x: iconLeft + mmToPt(5.5), top: top + mmToPt(11.3) },
      { type: "L", x: iconLeft + mmToPt(7.2), top: top + mmToPt(9.5) },
      { type: "C", x1: iconLeft + mmToPt(4.3), top1: top + mmToPt(6.3), x2: iconLeft + mmToPt(4.1), top2: top + mmToPt(3.1), x: iconLeft + mmToPt(5.8), top }
    ]);
    content += filledPathCommand(pageHeight, blue, [
      { type: "M", x: iconLeft + mmToPt(5.5), top: top + mmToPt(11.3) },
      { type: "L", x: iconLeft + mmToPt(7.2), top: top + mmToPt(9.5) },
      { type: "L", x: iconLeft + mmToPt(7.2), top: top + mmToPt(14.5) }
    ]);
    content += filledPathCommand(pageHeight, red, [
      { type: "M", x: iconLeft + mmToPt(10.3), top: top + mmToPt(1.7) },
      { type: "C", x1: iconLeft + mmToPt(12.3), top1: top + mmToPt(5.3), x2: iconLeft + mmToPt(10.7), top2: top + mmToPt(9.1), x: iconLeft + mmToPt(5), top: top + mmToPt(12.5) },
      { type: "L", x: iconLeft + mmToPt(2), top: top + mmToPt(15.5) },
      { type: "L", x: iconLeft + mmToPt(2), top: top + mmToPt(11.6) },
      { type: "C", x1: iconLeft + mmToPt(7), top1: top + mmToPt(8.1), x2: iconLeft + mmToPt(9.4), top2: top + mmToPt(4.6), x: iconLeft + mmToPt(10.3), top: top + mmToPt(1.7) }
    ]);
    content += ellipseCommand(
      pageHeight,
      iconLeft + mmToPt(5.7),
      top + mmToPt(5.7),
      mmToPt(2.2),
      mmToPt(1.35),
      yellow
    );
    content += textCommand(pageHeight, "ADUANA", textLeft, top + mmToPt(2), {
      color: blue,
      font: "serif",
      maxWidth: textWidth,
      minimumSize: 7,
      size: 9
    });
    content += textCommand(pageHeight, "DEL", textLeft, top + mmToPt(6.5), {
      color: blue,
      font: "serif",
      maxWidth: textWidth,
      minimumSize: 7,
      size: 8.5
    });
    content += textCommand(pageHeight, "ECUADOR", textLeft, top + mmToPt(10.7), {
      color: blue,
      font: "serif",
      maxWidth: textWidth,
      minimumSize: 7,
      size: 8.5
    });
    return content;
  }

  function rectCommand(pageHeight, x, top, width, height, options = {}) {
    const y = pageHeight - Number(top) - Number(height);
    if (options.fill) {
      return `0 g ${Number(x).toFixed(3)} ${y.toFixed(3)} ${Number(width).toFixed(3)} ${Number(height).toFixed(3)} re f\n`;
    }
    return `${Number(options.lineWidth || 0.7).toFixed(2)} w ${Number(x).toFixed(3)} ${y.toFixed(3)} ${Number(width).toFixed(3)} ${Number(height).toFixed(3)} re S\n`;
  }

  function barcodePattern(value) {
    const key = String(value || "");
    if (barcodePatternCache.has(key)) return barcodePatternCache.get(key);
    const barcodeSvg = BlessERP.code128?.barcodeSvg?.(key, { height: 50, quietZone: 12 }) || "";
    const viewBox = barcodeSvg.match(/viewBox="0 0 ([0-9.]+) ([0-9.]+)"/i);
    const pattern = {
      totalWidth: Number(viewBox?.[1] || 0),
      bars: [...barcodeSvg.matchAll(/<rect x="([0-9.]+)" y="0" width="([0-9.]+)" height="([0-9.]+)"\/>/gi)]
        .map(match => ({ x: Number(match[1]), width: Number(match[2]) }))
    };
    barcodePatternCache.set(key, pattern);
    return pattern;
  }

  function barcodeCommand(pageHeight, value, x, top, width, height) {
    const pattern = barcodePattern(value);
    const totalWidth = pattern.totalWidth;
    if (!totalWidth) return "";

    return pattern.bars.map(bar => {
      const barX = Number(x) + ((bar.x / totalWidth) * Number(width));
      const barWidth = Math.max(0.35, (bar.width / totalWidth) * Number(width));
      return rectCommand(pageHeight, barX, top, barWidth, height, { fill: true });
    }).join("");
  }

  function buildBunchPage(label) {
    const width = mmToPt(BUNCH_PAGE_MM.width);
    const height = mmToPt(BUNCH_PAGE_MM.height);
    const horizontalMargin = mmToPt(3);
    const availableWidth = width - (horizontalMargin * 2);
    const contentWidth = availableWidth * BUNCH_CONTENT_SCALE;
    const contentLeft = (width - contentWidth) / 2;
    const rawCode = String(label?.code || "").replace(/[\r\n\t ]+/g, "").toUpperCase();
    const structured = rawCode.startsWith("BF2") || rawCode.startsWith("BF|");
    const modernZebra = structured || label?.compactZebra === true;
    const barcodeWidth = modernZebra ? availableWidth : (contentWidth * BUNCH_BARCODE_SCALE);
    const barcodeLeft = (width - barcodeWidth) / 2;
    const scaledTop = topMm => 1 + ((Number(topMm) - 1) * BUNCH_CONTENT_SCALE);
    const title = modernZebra
      ? String(label?.variety || "VARIEDAD").toUpperCase()
      : `${String(label?.variety || "VARIEDAD").toUpperCase()} ${Number(label?.stemsPerBunch || 0)} STEMS`;
    const supplier = label?.labelType === "MIXTA" ? "BLESS FL" : (label?.block || "SIN BLOQUE");
    const meta = modernZebra
      ? `${Number(label?.stemsPerBunch || 0)} STEMS  |  ${label?.length || "-"} CM  |  ${String(label?.colorDay || label?.color || "SIN COLOR").toUpperCase()}`
      : `${supplier}  |  ${label?.length || "-"} CM  |  ${String(label?.buncher || "SIN EMBONCHADOR").toUpperCase()}`;
    const type = String(label?.type || (label?.labelType === "MIXTA" ? "MIXTO" : "INDIVIDUAL")).toUpperCase();
    const individual = label?.labelType === "MIXTA" ? "" : [label?.provider, label?.block].filter(Boolean).join("  ");
    const detail = modernZebra ? [type, individual].filter(Boolean).join("  |  ") : "";
    const code = structured ? rawCode : rawCode.padStart(10, "0").slice(-10);
    let content = "";

    content += textCommand(height, title, contentLeft, mmToPt(scaledTop(1)), {
      align: "center",
      bold: true,
      maxWidth: contentWidth,
      minimumSize: 7,
      size: 12 * BUNCH_CONTENT_SCALE
    });
    content += textCommand(height, meta, contentLeft, mmToPt(scaledTop(6.2)), {
      align: "center",
      bold: true,
      maxWidth: contentWidth,
      minimumSize: 5.5,
      size: 9 * BUNCH_CONTENT_SCALE
    });
    if (modernZebra) {
      content += textCommand(height, detail, contentLeft, mmToPt(scaledTop(10.2)), {
        align: "center",
        bold: true,
        maxWidth: contentWidth,
        minimumSize: 4.8,
        size: 7 * BUNCH_CONTENT_SCALE
      });
    }
    content += barcodeCommand(
      height,
      code,
      barcodeLeft,
      mmToPt(scaledTop(modernZebra ? 14 : 10.5)),
      barcodeWidth,
      mmToPt((modernZebra ? 16 : 20.5) * BUNCH_CONTENT_SCALE * BUNCH_BARCODE_SCALE)
    );
    if (!modernZebra) {
      content += textCommand(height, code, contentLeft, mmToPt(scaledTop(34.5)), {
        bold: true,
        maxWidth: contentWidth * 0.32,
        minimumSize: 5,
        size: 8 * BUNCH_CONTENT_SCALE
      });
    }
    content += textCommand(height, "PRODUCT GROWN IN ECUADOR", modernZebra ? contentLeft : contentLeft + (contentWidth * 0.38), mmToPt(scaledTop(32.5)), {
      align: modernZebra ? "center" : "left",
      bold: true,
      maxWidth: modernZebra ? contentWidth : (contentWidth * 0.62),
      minimumSize: 4.5,
      size: 7.5 * BUNCH_CONTENT_SCALE
    });
    if (BlessERP.flowerQuality?.isTipoB?.(label?.quality)) {
      content += textCommand(height, "TIPO B", contentLeft, mmToPt(30.5), {
        align: "right",
        bold: true,
        maxWidth: contentWidth,
        minimumSize: 7,
        size: 8.5
      });
    }

    return { content, width, height };
  }

  function buildBunchPdfBytes(labels) {
    const list = Array.isArray(labels) ? labels.filter(Boolean) : [];
    if (!list.length) throw new Error("No hay etiquetas de ramo para generar.");
    return createPdf(list.map(buildBunchPage));
  }

  function buildProductTable(pageHeight, row, left, top, width, height) {
    const sourceLines = Array.isArray(row?.contenido_lineas) ? row.contenido_lineas : [];
    const lines = sourceLines.length ? sourceLines : [{ variety: "", length: "", bunches: "", totalStems: "" }];
    const minimumRows = 6;
    const rowCount = Math.max(minimumRows, lines.length);
    const headerHeight = mmToPt(7);
    const footerHeight = mmToPt(7);
    const bodyHeight = height - headerHeight - footerHeight;
    const rowHeight = bodyHeight / rowCount;
    const columns = [0, 0.47, 0.66, 0.82, 1].map(value => left + (width * value));
    let content = rectCommand(pageHeight, left, top, width, height, { lineWidth: 0.8 });

    columns.slice(1, -1).forEach(x => {
      content += lineCommand(pageHeight, x, top, x, top + height, 0.55);
    });
    content += lineCommand(pageHeight, left, top + headerHeight, left + width, top + headerHeight, 0.65);
    for (let index = 1; index <= rowCount; index += 1) {
      content += lineCommand(pageHeight, left, top + headerHeight + (rowHeight * index), left + width, top + headerHeight + (rowHeight * index), 0.35);
    }
    content += lineCommand(pageHeight, left, top + height - footerHeight, left + width, top + height - footerHeight, 0.65);

    const headings = ["PRODUCTO / VARIETY", "GRADE", "BUNCH", "STEMS"];
    headings.forEach((heading, index) => {
      content += textCommand(pageHeight, heading, columns[index] + mmToPt(0.7), top + mmToPt(2), {
        align: "center",
        bold: true,
        maxWidth: (columns[index + 1] - columns[index]) - mmToPt(1.4),
        minimumSize: 4.2,
        size: 6.6
      });
    });

    for (let index = 0; index < rowCount; index += 1) {
      const line = lines[index] || {};
      const values = [
        String(line.variety || "").toUpperCase(),
        line.length ? `${line.length} CM` : "",
        line.bunches || "",
        line.totalStems || ""
      ];
      values.forEach((value, columnIndex) => {
        content += textCommand(pageHeight, value, columns[columnIndex] + mmToPt(0.7), top + headerHeight + (rowHeight * index) + Math.max(1, (rowHeight - 7) / 2), {
          align: columnIndex ? "center" : "left",
          bold: columnIndex === 0,
          maxWidth: (columns[columnIndex + 1] - columns[columnIndex]) - mmToPt(1.4),
          minimumSize: 3.8,
          size: Math.min(7.2, Math.max(4.2, rowHeight * 0.48))
        });
      });
    }

    const footerTop = top + height - footerHeight + mmToPt(2);
    content += textCommand(pageHeight, "TOTAL BUNCHS / STEMS", left + mmToPt(1), footerTop, {
      bold: true,
      maxWidth: columns[2] - left - mmToPt(2),
      size: 6.5
    });
    content += textCommand(pageHeight, row?.total_ramos || 0, columns[2] + mmToPt(0.7), footerTop, {
      align: "center",
      bold: true,
      maxWidth: columns[3] - columns[2] - mmToPt(1.4),
      size: 7
    });
    content += textCommand(pageHeight, row?.total_tallos || 0, columns[3] + mmToPt(0.7), footerTop, {
      align: "center",
      bold: true,
      maxWidth: columns[4] - columns[3] - mmToPt(1.4),
      size: 7
    });
    return content;
  }

  function buildBoxPage(row, company = {}) {
    const width = mmToPt(BOX_PAGE_MM.width);
    const height = mmToPt(BOX_PAGE_MM.height);
    const edge = mmToPt(0.25);
    const innerWidth = width - (edge * 2);
    const headerTop = edge;
    const headerHeight = mmToPt(41.5);
    const detailsTop = mmToPt(42.25);
    const detailsHeight = mmToPt(43);
    const productTop = mmToPt(85.75);
    const productHeight = mmToPt(50.5);
    const footerTop = mmToPt(136.75);
    const footerHeight = height - footerTop - edge;
    const leftText = mmToPt(2);
    const detailsWidth = width - mmToPt(4);
    let content = "";

    content += rectCommand(height, edge, headerTop, innerWidth, headerHeight, { lineWidth: 0.7 });
    content += aduanaLogoCommand(height, width / 2, mmToPt(0.6));
    content += barcodeCommand(height, row?.dae || row?.dae_barcode, mmToPt(4), mmToPt(17.2), mmToPt(92), mmToPt(9));
    content += textCommand(height, row?.dae_barcode || row?.dae || "-", mmToPt(4), mmToPt(26.8), {
      align: "center",
      bold: true,
      maxWidth: mmToPt(92),
      minimumSize: 4.6,
      size: 5.7
    });
    content += textCommand(height, `PAIS DESTINO: ${String(row?.pais || row?.destino || "-").toUpperCase()}`, mmToPt(4), mmToPt(33.5), {
      align: "center",
      bold: true,
      maxWidth: mmToPt(92),
      minimumSize: 6,
      size: 8
    });

    content += rectCommand(height, edge, detailsTop, innerWidth, detailsHeight, { lineWidth: 0.7 });
    const boxFrom = /bless/i.test(`${company.company_key || company.id || ""} ${company.commercialName || ""}`)
      ? `${company.legalName || company.commercialName || "BLESS FLOWER"} (BLESS FLOWER)`
      : (company.legalName || company.commercialName || "EMPRESA");
    content += textCommand(height, `FROM: ${String(boxFrom).toUpperCase()}`, leftText, detailsTop + mmToPt(2), {
      bold: true,
      maxWidth: detailsWidth,
      minimumSize: 5.5,
      size: 8
    });
    content += textCommand(height, `RUC: ${company.ruc || "-"}`, leftText, detailsTop + mmToPt(7), {
      bold: true,
      maxWidth: detailsWidth,
      size: 8
    });
    content += textCommand(height, `TO: ${String(row?.marca || row?.destino || "-").toUpperCase()}`, leftText, detailsTop + mmToPt(12), {
      bold: true,
      maxWidth: detailsWidth,
      minimumSize: 5.5,
      size: 8
    });
    content += textCommand(height, `PO: ${row?.po || "-"}`, leftText, detailsTop + mmToPt(17), {
      bold: true,
      maxWidth: detailsWidth,
      size: 8
    });
    content += textCommand(height, `INVOICE: ${row?.invoice_no || "-"}`, leftText, detailsTop + mmToPt(22), {
      bold: true,
      maxWidth: detailsWidth,
      minimumSize: 5.2,
      size: 7.5
    });
    content += textCommand(height, `AWB: ${row?.awb || "-"}`, leftText, detailsTop + mmToPt(27), {
      bold: true,
      maxWidth: detailsWidth,
      size: 7.5
    });
    content += textCommand(height, `HAWB: ${row?.hawb || "-"}`, leftText, detailsTop + mmToPt(32), {
      bold: true,
      maxWidth: detailsWidth,
      size: 7.5
    });
    content += textCommand(height, `BOX #: ${row?.numero_caja || "-"}`, leftText, detailsTop + mmToPt(37), {
      bold: true,
      maxWidth: detailsWidth,
      size: 8
    });

    content += buildProductTable(
      height,
      row,
      edge,
      productTop,
      innerWidth,
      productHeight
    );

    content += rectCommand(height, edge, footerTop, innerWidth, footerHeight, { lineWidth: 0.7 });
    content += textCommand(height, "PRODUCT GROWN IN ECUADOR", edge, footerTop + mmToPt(3), {
      align: "center",
      bold: true,
      maxWidth: innerWidth,
      size: 10
    });
    content += textCommand(height, `AGENCY: ${String(row?.agencia_carga || "-").toUpperCase()}`, mmToPt(2), footerTop + mmToPt(10), {
      bold: true,
      maxWidth: mmToPt(46),
      minimumSize: 5,
      size: 6.8
    });
    content += textCommand(height, `COLD ROOM: ${String(row?.cuarto_frio || "-").toUpperCase()}`, mmToPt(52), footerTop + mmToPt(10), {
      bold: true,
      maxWidth: mmToPt(46),
      minimumSize: 4.8,
      size: 6.8
    });
    content += textCommand(height, `${row?.pedido_numero || "-"} / INVOICE ${row?.invoice_no || "-"}`, mmToPt(2), footerTop + mmToPt(17), {
      align: "center",
      maxWidth: width - mmToPt(4),
      minimumSize: 4.5,
      size: 6
    });

    return { content, width, height };
  }

  function resolveBoxPages(orders, appState, options = {}) {
    const sourceOrders = Array.isArray(orders) ? orders.filter(Boolean) : [];
    return sourceOrders.flatMap(order => {
      const key = String(order?.id || order?.number || "");
      const prepared = options.preparedDocumentDataByOrder?.get?.(key);
      const documentData = prepared
        || BlessERP.comercialLabelsUtils?.buildDocumentData?.(order, appState, options);
      const company = BlessERP.services?.companyBranding?.resolveForOrder?.(order)
        || BlessERP.comercialData?.company
        || {};
      return (documentData?.selectedRows || []).map(row => buildBoxPage(row, company));
    });
  }

  function yieldToBrowser() {
    return new Promise(resolve => window.setTimeout(resolve, 0));
  }

  async function resolveBoxPagesAsync(orders, appState, options = {}, onProgress = null) {
    const sourceOrders = Array.isArray(orders) ? orders.filter(Boolean) : [];
    const preparedOrders = sourceOrders.map(order => {
      const key = String(order?.id || order?.number || "");
      const documentData = options.preparedDocumentDataByOrder?.get?.(key)
        || BlessERP.comercialLabelsUtils?.buildDocumentData?.(order, appState, options);
      const company = BlessERP.services?.companyBranding?.resolveForOrder?.(order)
        || BlessERP.comercialData?.company
        || {};
      return { company, rows: documentData?.selectedRows || [] };
    });
    const total = preparedOrders.reduce((sum, item) => sum + item.rows.length, 0);
    const pages = [];
    for (const item of preparedOrders) {
      for (const row of item.rows) {
        pages.push(buildBoxPage(row, item.company));
        onProgress?.({ phase: "labels", current: pages.length, total });
        if (pages.length % BOX_LABEL_YIELD_INTERVAL === 0) await yieldToBrowser();
      }
    }
    return pages;
  }

  function buildBoxPdfBytes(orders, appState, options = {}) {
    const pages = resolveBoxPages(orders, appState, options);
    if (!pages.length) throw new Error("No hay etiquetas de caja para generar.");
    return createPdf(pages);
  }

  function downloadPdf(bytes, fileName) {
    const blob = new Blob([bytes], { type: "application/pdf" });
    if (window.navigator?.msSaveOrOpenBlob) {
      window.navigator.msSaveOrOpenBlob(blob, fileName);
      return true;
    }
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
    return true;
  }

  function downloadBunchLabels(labels) {
    const startedAt = BlessERP.performance?.now?.() || performance.now();
    try {
      const bytes = buildBunchPdfBytes(labels);
      const first = labels?.[0]?.code || "RAMOS";
      const downloaded = downloadPdf(bytes, `ETIQUETAS_RAMO_${cleanFileToken(first)}.pdf`);
      BlessERP.layout?.toast?.("PDF de etiquetas descargado. Abralo en Adobe Acrobat e imprima en Tamano real / 100 %.");
      return downloaded;
    } catch (error) {
      BlessERP.layout?.toast?.(`No se pudo generar el PDF de etiquetas: ${error.message}`);
      return false;
    } finally {
      BlessERP.performance?.record?.("etiqueta:pdf-ramos", startedAt, { labels: labels?.length || 0 });
    }
  }

  function downloadBoxLabels(orders, appState, options = {}) {
    const startedAt = BlessERP.performance?.now?.() || performance.now();
    try {
      const bytes = buildBoxPdfBytes(orders, appState, options);
      const reference = orders?.[0]?.number || orders?.[0]?.id || "CAJAS";
      const downloaded = downloadPdf(bytes, `ETIQUETAS_CAJA_${cleanFileToken(reference)}.pdf`);
      BlessERP.layout?.toast?.("PDF de etiquetas descargado. Abralo en Adobe Acrobat e imprima en Tamano real / 100 %.");
      return downloaded;
    } catch (error) {
      BlessERP.layout?.toast?.(`No se pudo generar el PDF de etiquetas: ${error.message}`);
      return false;
    } finally {
      BlessERP.performance?.record?.("etiqueta:pdf-cajas", startedAt, { orders: orders?.length || 0 });
    }
  }

  async function downloadBoxLabelsAsync(orders, appState, options = {}, onProgress = null) {
    const startedAt = BlessERP.performance?.now?.() || performance.now();
    try {
      const pages = await resolveBoxPagesAsync(orders, appState, options, onProgress);
      if (!pages.length) throw new Error("No hay etiquetas de caja para generar.");
      onProgress?.({ phase: "pages", current: pages.length, total: pages.length });
      await yieldToBrowser();
      const bytes = createPdf(pages);
      onProgress?.({ phase: "file", current: pages.length, total: pages.length });
      const reference = orders?.[0]?.number || orders?.[0]?.id || "CAJAS";
      const downloaded = downloadPdf(bytes, `ETIQUETAS_CAJA_${cleanFileToken(reference)}.pdf`);
      onProgress?.({ phase: "download", current: pages.length, total: pages.length });
      BlessERP.layout?.toast?.("PDF de etiquetas descargado. Abralo en Adobe Acrobat e imprima en Tamano real / 100 %.");
      return downloaded;
    } catch (error) {
      BlessERP.layout?.toast?.(`No se pudo generar el PDF de etiquetas: ${error.message}`);
      return false;
    } finally {
      BlessERP.performance?.record?.("etiqueta:pdf-cajas", startedAt, { orders: orders?.length || 0 });
    }
  }

  BlessERP.labelPdf = {
    BOX_PAGE_MM,
    BUNCH_PAGE_MM,
    BUNCH_BARCODE_SCALE,
    BUNCH_BOTTOM_CLEARANCE_MM,
    BUNCH_CONTENT_SCALE,
    buildBoxPdfBytes,
    buildBunchPdfBytes,
    createPdf,
    downloadBoxLabels,
    downloadBoxLabelsAsync,
    downloadBunchLabels,
    mmToPt
  };
})();
