import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

/**
 * Word-facing font stack. Prefer single-quoted style attributes so nested
 * font names never break HTML (double-quoted style="font-family:Calibri, "X""
 * truncates and Word falls back to Arial/Normal).
 */
const FONT_CSS =
  "font-family:Calibri;mso-ascii-font-family:Calibri;mso-fareast-font-family:PMingLiU;mso-hansi-font-family:Calibri;mso-bidi-font-family:Arial";
const FONT_SIZE = "12.0pt";

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nl2br(s) {
  return escapeHtml(s).replace(/\r\n|\n|\r/g, "<br/>");
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

/** Inline image bytes Word desktop actually displays in Word-HTML `.doc`. */
function dataUriFromBuffer(mime, buf) {
  return `data:${mime};base64,${Buffer.from(buf).toString("base64")}`;
}

function dataUriFromFile(filePath) {
  return dataUriFromBuffer(mimeFor(filePath), fs.readFileSync(filePath));
}

function p(styleExtra, inner) {
  const style = `${FONT_CSS};font-size:${FONT_SIZE};${styleExtra}`;
  return `<p class="MsoNormal" style='${style}'>${inner}</p>`;
}

/**
 * Pull the letterhead PNG already stored inside site-memo-template.doc
 * (OLE Data stream). Do not use docs/site-memo-assets/lap-kei-letterhead.png
 * as a separate header asset — the template is the source of truth.
 */
export function extractLetterheadPngFromTemplate(templatePath = config.templateDoc) {
  const buf = fs.readFileSync(templatePath);
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const start = buf.indexOf(pngSig);
  if (start < 0) {
    throw new Error(
      `No PNG letterhead found inside template: ${templatePath}`
    );
  }
  const iend = buf.indexOf(Buffer.from("IEND"), start);
  if (iend < 0) {
    throw new Error(
      `Truncated PNG letterhead inside template: ${templatePath}`
    );
  }
  // IEND + CRC (4 bytes)
  return buf.subarray(start, iend + 8);
}

/**
 * Printed display size only — full original pixels stay in the data: URI so
 * Word users can enlarge/crop later. Target ≈ 1/8–1/12 of an A4 page:
 * usable width ~16cm; single photo ~6cm; multi-photo cells a bit smaller.
 * 96 CSS px/in → 6cm ≈ 227px (Word HTML width= attribute).
 */
const PHOTO_DISPLAY = {
  singleCm: 6.0,
  pairCm: 5.5,
  gridCm: 5.0,
  cmToPx(cm) {
    return Math.round((cm / 2.54) * 96);
  },
};

export function photoDisplaySize(imageCount) {
  const n = Math.max(1, imageCount | 0);
  const cm =
    n === 1
      ? PHOTO_DISPLAY.singleCm
      : n === 2
        ? PHOTO_DISPLAY.pairCm
        : PHOTO_DISPLAY.gridCm;
  return { cm, px: PHOTO_DISPLAY.cmToPx(cm) };
}

function photoImgHtml(imgSrc, alt, display) {
  // width=/style width only constrain Word layout; src keeps full-resolution bytes.
  return `<img width="${display.px}" src="${imgSrc}" alt="${escapeHtml(alt)}"
          style='width:${display.cm}cm;max-width:100%;height:auto;'/>`;
}

/**
 * Lay out 1..N photos inside one bordered cell: single centered, 2 side-by-side,
 * 3+ as a 2-column nested table. Still one outer photo-block border.
 */
function photoImagesCellHtml(imgSrcs, blockIndex) {
  const display = photoDisplaySize(imgSrcs.length);
  if (imgSrcs.length === 1) {
    return `<p class="MsoNormal" align="center" style='${FONT_CSS};font-size:${FONT_SIZE};margin:0;text-align:center;'>
        ${photoImgHtml(imgSrcs[0], `photo ${blockIndex + 1}`, display)}
      </p>`;
  }

  const cols = 2;
  const rows = [];
  for (let i = 0; i < imgSrcs.length; i += cols) {
    const slice = imgSrcs.slice(i, i + cols);
    const tds = slice
      .map(
        (src, j) =>
          `<td valign="middle" align="center" style='padding:2.0pt 4.0pt;border:none;'>
            <p class="MsoNormal" align="center" style='${FONT_CSS};font-size:${FONT_SIZE};margin:0;text-align:center;'>
              ${photoImgHtml(src, `photo ${blockIndex + 1}.${i + j + 1}`, display)}
            </p>
          </td>`
      )
      .join("");
    // Pad odd last row so borders stay even.
    const pad =
      slice.length < cols
        ? `<td valign="middle" style='padding:2.0pt 4.0pt;border:none;'><p class="MsoNormal" style='margin:0;'>&nbsp;</p></td>`
        : "";
    rows.push(`<tr>${tds}${pad}</tr>`);
  }

  return `<table class="MsoNormalTable photo-row" border="0" cellspacing="0" cellpadding="0"
        style='border-collapse:collapse;border:none;width:100%;'>
        ${rows.join("\n        ")}
      </table>`;
}

/**
 * SM-005 / template photo table: 1 col × 2 rows, BorderStyle.Single / 0.5pt.
 * Images use data: URIs (proven on Word desktop before MHTML format PRs).
 * One block = one or more photos + one caption (multi-photo under shared border).
 */
function photoTableHtml(imgSrcs, caption, index) {
  const srcs = Array.isArray(imgSrcs) ? imgSrcs : [imgSrcs];
  const cell =
    "border:solid windowtext .5pt;mso-border-alt:solid windowtext .5pt;padding:4.0pt 4.0pt 4.0pt 4.0pt";
  return `
<table class="MsoNormalTable photo-block" border="1" cellspacing="0" cellpadding="0"
  style='border-collapse:collapse;border:none;mso-border-alt:solid windowtext .5pt;width:100%;margin:10.0pt 0;'>
  <tr>
    <td valign="top" style='width:100%;${cell}'>
      ${photoImagesCellHtml(srcs, index)}
    </td>
  </tr>
  <tr>
    <td valign="top" style='width:100%;${cell}'>
      <p class="MsoNormal" style='${FONT_CSS};font-size:${FONT_SIZE};margin:0;'>${nl2br(caption)}</p>
    </td>
  </tr>
</table>`;
}

/**
 * Space-padded two-column routing block — matches site-memo-template.doc /
 * SM-005 paragraph layout (not an HTML table).
 */
function routingHtml(payload, locked, copyTo) {
  const fromLine = `From&nbsp;&nbsp;&nbsp;:&nbsp;${escapeHtml(locked.from_name)}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;To&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;:&nbsp;&nbsp;${escapeHtml(locked.to_names)}`;
  const dateLine = `Date&nbsp;&nbsp;&nbsp;&nbsp;:&nbsp;${escapeHtml(payload.date)}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Company:&nbsp;&nbsp;${escapeHtml(locked.company)}`;
  const refLine = `Our Ref.&nbsp;:&nbsp;${escapeHtml(locked.our_ref_prefix)}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Copy to&nbsp;&nbsp;:&nbsp;&nbsp;${escapeHtml(copyTo)}`;
  const numLine = `編號&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${escapeHtml(payload.memo_number)}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;副本致`;

  return [
    p("margin:0;", fromLine),
    p("margin:0;font-size:10.0pt;mso-fareast-font-family:PMingLiU;", "由&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;致"),
    p("margin:0;", dateLine),
    p("margin:0;font-size:10.0pt;mso-fareast-font-family:PMingLiU;", "日期&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;公司"),
    p("margin:0;", refLine),
    p("margin:0 0 10.0pt 0;font-size:10.0pt;mso-fareast-font-family:PMingLiU;", numLine),
  ].join("\n");
}

function bodyHtml(payload) {
  const parts = [];
  if (payload.body_intro) {
    parts.push(
      p("margin:0 0 6.0pt 0;", nl2br(payload.body_intro))
    );
  }
  const bodyItems = Array.isArray(payload.body_items) ? payload.body_items : [];
  for (const item of bodyItems) {
    if (typeof item === "string") {
      // SM-005 style: indented dash bullets (not HTML <ul>, which Word restyles).
      parts.push(
        p("margin:0 0 4.0pt 24.0pt;text-indent:-12.0pt;", `- ${nl2br(item)}`)
      );
      continue;
    }
    const text = item.item_text || item.text || "";
    const reason = item.reason
      ? `<br/>Reason: ${escapeHtml(item.reason)}`
      : "";
    if (item.item_number != null) {
      parts.push(
        p(
          "margin:0 0 6.0pt 0;",
          `${escapeHtml(item.item_number)}) ${nl2br(text)}${reason}`
        )
      );
    } else {
      parts.push(
        p("margin:0 0 4.0pt 24.0pt;text-indent:-12.0pt;", `- ${nl2br(text)}${reason}`)
      );
    }
  }
  return parts.join("\n");
}

/**
 * Build Word-openable HTML (saved as `.doc`). Images are inline
 * `data:image/...;base64,...` — the strategy that displayed photos in Word
 * before format-matching MHTML PRs (#12–#15). MHTML cid / relative
 * SiteMemo_files embeds still show “The picture can't be displayed” (SM-009).
 */
export function buildSiteMemoHtml(payload) {
  const locked = config.projectLocked;
  const copyTo = payload.copy_to ?? "";

  const letterheadBuf = extractLetterheadPngFromTemplate(config.templateDoc);
  const letterheadSrc = dataUriFromBuffer("image/png", letterheadBuf);

  const photoBlocks = Array.isArray(payload.photo_blocks) ? payload.photo_blocks : [];
  const photosHtml = photoBlocks
    .map((block, i) => {
      const paths =
        Array.isArray(block.absolutePaths) && block.absolutePaths.length
          ? block.absolutePaths
          : block.absolutePath
            ? [block.absolutePath]
            : [];
      const srcs = paths.map((p) => dataUriFromFile(p));
      return photoTableHtml(srcs, block.caption || "", i);
    })
    .join("\n");

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:w="urn:schemas-microsoft-com:office:word"
xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta name="ProgId" content="Word.Document">
<meta name="Generator" content="Site Memo Draft UI">
<title>Site Memo ${escapeHtml(payload.memo_number)}</title>
<!--[if gte mso 9]>
<xml>
  <o:DocumentProperties>
    <o:Author>Lap Kei Engineering</o:Author>
  </o:DocumentProperties>
  <w:WordDocument>
    <w:View>Print</w:View>
    <w:Zoom>100</w:Zoom>
    <w:DoNotOptimizeForBrowser/>
  </w:WordDocument>
</xml>
<![endif]-->
<style>
  /* Mirror site-memo-template.doc / SM-005: Calibri 12pt body, PMingLiU for ZH */
  @page Section1 {
    size: 595.3pt 841.9pt;
    margin: 42.55pt 51.05pt 42.55pt 51.05pt;
    mso-header-margin: 36.0pt;
    mso-footer-margin: 36.0pt;
  }
  div.Section1 { page: Section1; }
  body {
    ${FONT_CSS};
    font-size: ${FONT_SIZE};
    color: windowtext;
  }
  p.MsoNormal, li.MsoNormal, div.MsoNormal {
    margin: 0;
    ${FONT_CSS};
    font-size: ${FONT_SIZE};
    mso-fareast-language: ZH-TW;
  }
  span.zh { font-family: PMingLiU; mso-fareast-font-family: PMingLiU; font-size: 10.0pt; }
  img { border: 0; }
</style>
</head>
<body lang="EN-US" style='tab-interval:36.0pt'>
<div class="Section1">

<p class="MsoNormal" align="center" style='text-align:center;margin:0;'>
  <img width="640" src="${letterheadSrc}" alt="Lap Kei Engineering letterhead"
    style='width:640px;max-width:100%;height:auto;'/>
</p>

<p class="MsoNormal" align="center" style='${FONT_CSS};font-size:14.0pt;font-weight:bold;text-align:center;margin:8.0pt 0 10.0pt 0;'>Site Memo</p>

${routingHtml(payload, locked, copyTo)}

<p class="MsoNormal" style='${FONT_CSS};font-size:${FONT_SIZE};margin:10.0pt 0 6.0pt 0;'>
  <u><b>Project:</b></u> ${escapeHtml(locked.project_title)}
</p>
<p class="MsoNormal" style='${FONT_CSS};font-size:${FONT_SIZE};margin:0 0 10.0pt 0;'>
  <u><b>Subject:</b></u> ${escapeHtml(payload.subject)}
</p>

${bodyHtml(payload)}
${photosHtml}

${p("margin:18.0pt 0 0 0;", "Yours faithfully,")}
${p("margin:0;", "For and on behalf of")}
${p("margin:0;", escapeHtml(locked.closing_company))}
<p class="MsoNormal" style='${FONT_CSS};font-size:${FONT_SIZE};margin:0;'>&nbsp;</p>
<p class="MsoNormal" style='${FONT_CSS};font-size:${FONT_SIZE};margin:0;'>&nbsp;</p>
<p class="MsoNormal" style='${FONT_CSS};font-size:${FONT_SIZE};margin:0;'>&nbsp;</p>
${p("margin:0;", escapeHtml(locked.signatory_name))}
${p("margin:0;", escapeHtml(locked.signatory_title))}
${p("margin:6.0pt 0 0 0;font-size:10.0pt;", escapeHtml(locked.ref_initials))}

</div>
</body>
</html>
`;
}

function isPng(bytes) {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

function isJpeg(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function isGif(bytes) {
  return (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46
  );
}

/**
 * Validate Word-HTML `.doc` image embeds by decoding each data: URI to bytes
 * and checking image magic — not Content-Location string matching (SM-009
 * had valid MHTML parts + refs and Word still failed).
 */
export function verifyWordHtmlImageEmbeds(htmlOrDoc) {
  const html = String(htmlOrDoc).replace(/^\uFEFF/, "");
  const problems = [];

  if (/^MIME-Version:/m.test(html) || /multipart\/related/i.test(html)) {
    problems.push(
      "document is MHTML; Word desktop rejects Site Memo MHTML image embeds (use Word HTML + data: URIs)"
    );
  }
  if (/SiteMemo_files\//.test(html)) {
    problems.push("relative SiteMemo_files/ refs present (SM-009 failed in Word)");
  }
  if (/\bsrc=["']cid:/i.test(html)) {
    problems.push("cid: primary src present (SM-008 failed in Word)");
  }
  if (/\bsrc=["']file:/i.test(html)) {
    problems.push("file:/// img src present (dead external link in Word)");
  }

  const dataUris = [
    ...html.matchAll(
      /<img\b[^>]*?\bsrc=["'](data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)["']/gi
    ),
  ].map((m) => m[1]);

  if (dataUris.length === 0) {
    problems.push("no data:image/...;base64 img src found");
  }

  const decoded = [];
  for (let i = 0; i < dataUris.length; i++) {
    const uri = dataUris[i];
    const m = uri.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) {
      problems.push(`img[${i}] malformed data URI`);
      continue;
    }
    const mime = m[1].toLowerCase();
    let bytes;
    try {
      bytes = Buffer.from(m[2], "base64");
    } catch {
      problems.push(`img[${i}] base64 decode failed`);
      continue;
    }
    if (bytes.length < 32) {
      problems.push(`img[${i}] decoded too small (${bytes.length} bytes)`);
      continue;
    }
    const magicOk =
      (mime.includes("png") && isPng(bytes)) ||
      ((mime.includes("jpeg") || mime.includes("jpg")) && isJpeg(bytes)) ||
      (mime.includes("gif") && isGif(bytes)) ||
      isPng(bytes) ||
      isJpeg(bytes) ||
      isGif(bytes);
    if (!magicOk) {
      problems.push(`img[${i}] bad image magic for ${mime}`);
      continue;
    }
    decoded.push({ mime, bytes, byteLength: bytes.length });
  }

  // First image should be template letterhead PNG.
  if (decoded.length > 0) {
    const letterheadExpected = extractLetterheadPngFromTemplate(config.templateDoc);
    if (!decoded[0].bytes.equals(letterheadExpected)) {
      problems.push(
        "first img is not the PNG letterhead extracted from site-memo-template.doc"
      );
    }
  }

  if (problems.length) {
    throw new Error(
      `Word HTML image embed check failed:\n- ${problems.join("\n- ")}`
    );
  }

  return {
    imageCount: decoded.length,
    letterheadBytes: decoded[0]?.byteLength ?? 0,
    photoBytes: decoded.slice(1).map((d) => d.byteLength),
  };
}

/** @deprecated Alias kept for older smoke helpers; same as verifyWordHtmlImageEmbeds. */
export function verifyMhtmlImageEmbeds(htmlOrDoc) {
  return verifyWordHtmlImageEmbeds(htmlOrDoc);
}

export function writeSiteMemoDoc(outPath, payload) {
  const html = buildSiteMemoHtml(payload);
  verifyWordHtmlImageEmbeds(html);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // UTF-8 BOM helps Word on Windows detect encoding for CJK labels.
  fs.writeFileSync(outPath, `\uFEFF${html}`, "utf8");
  return outPath;
}
