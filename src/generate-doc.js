import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const FONT = 'Calibri, "PMingLiU", "SimSun", sans-serif';
const FONT_SIZE = "12pt";
const BOUNDARY = "----=_NextPart_SiteMemo_LK";
const HTML_LOC = "file:///C:/SiteMemo/SiteMemo.htm";
const ASSET_DIR = "file:///C:/SiteMemo/SiteMemo_files";

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

function extForMime(mime) {
  if (mime === "image/png") return ".png";
  if (mime === "image/gif") return ".gif";
  if (mime === "image/bmp") return ".bmp";
  if (mime === "image/webp") return ".webp";
  return ".jpg";
}

/** Word MHTML prefers CRLF and 76-char base64 lines. */
function wrapBase64(b64, width = 76) {
  const lines = [];
  for (let i = 0; i < b64.length; i += width) {
    lines.push(b64.slice(i, i + width));
  }
  return lines.join("\r\n");
}

function bodyFontStyle() {
  return `font-family:${FONT};font-size:${FONT_SIZE};`;
}

/**
 * SM-005-style bordered photo table: 1 col × 2 rows, Single / 0.5pt.
 * Images are referenced by Content-Location (MHTML parts), never data: URIs —
 * Word does not reliably render data: images and can truncate the rest of the doc.
 */
function photoTableHtml(imgSrc, caption, index) {
  return `
<table class="photo-block MsoNormalTable" border="1" cellspacing="0" cellpadding="0"
  style="border-collapse:collapse;border:none;mso-border-alt:solid windowtext .5pt;width:100%;margin:10pt 0;">
  <tr>
    <td valign="top" style="width:100%;border:solid windowtext .5pt;mso-border-alt:solid windowtext .5pt;padding:4.0pt;">
      <img src="${imgSrc}" alt="photo ${index + 1}" width="520" style="width:520px;max-width:100%;height:auto;"/>
    </td>
  </tr>
  <tr>
    <td valign="top" style="width:100%;border:solid windowtext .5pt;mso-border-alt:solid windowtext .5pt;padding:4.0pt;${bodyFontStyle()}">
      ${nl2br(caption)}
    </td>
  </tr>
</table>`;
}

/**
 * Build Word-openable HTML body (no MIME wrapper). Image srcs must be
 * Content-Location URLs that match MHTML parts.
 */
export function buildSiteMemoHtml(payload, assetUrls) {
  const locked = config.projectLocked;
  const letterheadSrc = assetUrls.letterhead;
  const photoSrcs = assetUrls.photos || [];

  const bodyItems = Array.isArray(payload.body_items) ? payload.body_items : [];
  const bulletsHtml =
    bodyItems.length > 0
      ? `<ul style="margin:6pt 0 12pt 24pt;padding:0;">
${bodyItems
  .map((item) => {
    if (typeof item === "string") {
      return `  <li style="margin:0 0 4pt 0;${bodyFontStyle()}">${nl2br(item)}</li>`;
    }
    const text = item.item_text || item.text || "";
    const reason = item.reason
      ? `<br/><span>Reason: ${escapeHtml(item.reason)}</span>`
      : "";
    const num = item.item_number != null ? `${escapeHtml(item.item_number)}) ` : "";
    return `  <li style="margin:0 0 6pt 0;${bodyFontStyle()}">${num}${nl2br(text)}${reason}</li>`;
  })
  .join("\n")}
</ul>`
      : "";

  const introHtml = payload.body_intro
    ? `<p style="${bodyFontStyle()}margin:0 0 8pt 0;">${nl2br(payload.body_intro)}</p>`
    : "";

  const photoBlocks = Array.isArray(payload.photo_blocks) ? payload.photo_blocks : [];
  const photosHtml = photoBlocks
    .map((block, i) =>
      photoTableHtml(photoSrcs[i], block.caption || "", i)
    )
    .join("\n");

  const copyTo = payload.copy_to ?? "";

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
  <w:WordDocument>
    <w:View>Print</w:View>
    <w:Zoom>100</w:Zoom>
    <w:DoNotOptimizeForBrowser/>
  </w:WordDocument>
</xml>
<![endif]-->
<style>
  /* Template / SM-005: Calibri 12pt body */
  @page { size: A4; margin: 1.5cm 1.8cm 1.5cm 1.8cm; }
  body { font-family: ${FONT}; font-size: ${FONT_SIZE}; color: #000; }
  table.routing { width: 100%; border-collapse: collapse; margin: 8pt 0 12pt 0; }
  table.routing td { vertical-align: top; font-size: ${FONT_SIZE}; font-family: ${FONT}; padding: 1pt 4pt 1pt 0; }
  .label-zh { font-family: "PMingLiU", "SimSun", sans-serif; font-size: 10pt; }
  h1.title { text-align: center; font-family: ${FONT}; font-size: 16pt; font-weight: bold; margin: 8pt 0 12pt 0; }
  .letterhead { width: 100%; max-width: 680px; height: auto; display: block; margin: 0 auto 6pt auto; }
  .field-line { margin: 10pt 0 6pt 0; font-family: ${FONT}; font-size: ${FONT_SIZE}; }
  .field-label { font-weight: bold; text-decoration: underline; }
</style>
</head>
<body>
<p style="text-align:center;margin:0;">
  <img class="letterhead" src="${letterheadSrc}" alt="Lap Kei Engineering letterhead"/>
</p>
<h1 class="title">Site Memo</h1>

<table class="routing" border="0" cellspacing="0" cellpadding="0">
  <tr>
    <td width="50%">From&nbsp;&nbsp;&nbsp;: ${escapeHtml(locked.from_name)}</td>
    <td width="50%">To&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: ${escapeHtml(locked.to_names)}</td>
  </tr>
  <tr>
    <td class="label-zh">由</td>
    <td class="label-zh">致</td>
  </tr>
  <tr>
    <td>Date&nbsp;&nbsp;&nbsp;&nbsp;: ${escapeHtml(payload.date)}</td>
    <td>Company: ${escapeHtml(locked.company)}</td>
  </tr>
  <tr>
    <td class="label-zh">日期</td>
    <td class="label-zh">公司</td>
  </tr>
  <tr>
    <td>Our Ref. : ${escapeHtml(locked.our_ref_prefix)}</td>
    <td>Copy to&nbsp;&nbsp;: ${escapeHtml(copyTo)}</td>
  </tr>
  <tr>
    <td class="label-zh">編號&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${escapeHtml(payload.memo_number)}</td>
    <td class="label-zh">副本致</td>
  </tr>
</table>

<p class="field-line" style="margin:10pt 0 6pt 0;">
  <u><b>Project:</b></u> ${escapeHtml(locked.project_title)}
</p>
<p class="field-line" style="margin:0 0 10pt 0;">
  <u><b>Subject:</b></u> ${escapeHtml(payload.subject)}
</p>

${introHtml}
${bulletsHtml}
${photosHtml}

<p style="${bodyFontStyle()}margin:18pt 0 0 0;">Yours faithfully,</p>
<p style="${bodyFontStyle()}margin:0;">For and on behalf of</p>
<p style="${bodyFontStyle()}margin:0 0 28pt 0;">${escapeHtml(locked.closing_company)}</p>
<p style="${bodyFontStyle()}margin:0;">${escapeHtml(locked.signatory_name)}</p>
<p style="${bodyFontStyle()}margin:0;">${escapeHtml(locked.signatory_title)}</p>
<p style="font-family:${FONT};font-size:10pt;margin:8pt 0 0 0;">${escapeHtml(locked.ref_initials)}</p>
</body>
</html>
`;
}

function mimePart({ contentLocation, contentType, transferEncoding, body }) {
  return [
    `--${BOUNDARY}`,
    `Content-Location: ${contentLocation}`,
    `Content-Transfer-Encoding: ${transferEncoding}`,
    `Content-Type: ${contentType}`,
    "",
    body,
  ].join("\r\n");
}

/**
 * Pack HTML + binary images as Word-compatible MHTML saved with a `.doc`
 * extension (same approach Word uses for single-file HTML with images).
 */
export function buildSiteMemoMhtml(payload) {
  const letterheadBuf = fs.readFileSync(config.letterhead);
  const letterheadLoc = `${ASSET_DIR}/letterhead.png`;

  const photoBlocks = Array.isArray(payload.photo_blocks) ? payload.photo_blocks : [];
  const photoAssets = photoBlocks.map((block, i) => {
    const filePath = block.absolutePath;
    const mime = mimeFor(filePath);
    const loc = `${ASSET_DIR}/photo${i}${extForMime(mime)}`;
    return {
      loc,
      mime,
      buf: fs.readFileSync(filePath),
    };
  });

  const html = buildSiteMemoHtml(payload, {
    letterhead: letterheadLoc,
    photos: photoAssets.map((a) => a.loc),
  });

  const parts = [];
  parts.push(
    mimePart({
      contentLocation: HTML_LOC,
      contentType: 'text/html; charset="utf-8"',
      transferEncoding: "base64",
      body: wrapBase64(Buffer.from(html, "utf8").toString("base64")),
    })
  );
  parts.push(
    mimePart({
      contentLocation: letterheadLoc,
      contentType: "image/png",
      transferEncoding: "base64",
      body: wrapBase64(letterheadBuf.toString("base64")),
    })
  );
  for (const asset of photoAssets) {
    parts.push(
      mimePart({
        contentLocation: asset.loc,
        contentType: asset.mime,
        transferEncoding: "base64",
        body: wrapBase64(asset.buf.toString("base64")),
      })
    );
  }

  const header = [
    "MIME-Version: 1.0",
    `Content-Type: multipart/related; boundary="${BOUNDARY}"`,
    "",
  ].join("\r\n");

  return `${header}${parts.join("\r\n")}\r\n--${BOUNDARY}--\r\n`;
}

export function writeSiteMemoDoc(outPath, payload) {
  const mhtml = buildSiteMemoMhtml(payload);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // MHTML is ASCII headers + base64; write as binary-safe utf8 (no BOM).
  fs.writeFileSync(outPath, mhtml, "utf8");
  return outPath;
}
