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
const BOUNDARY = "----=_NextPart_SiteMemo_LK";
const HTML_LOC = "file:///C:/SiteMemo/SiteMemo.htm";
const ASSET_DIR = "file:///C:/SiteMemo/SiteMemo_files";
const CID_DOMAIN = "sitememo.lk";

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

function p(styleExtra, inner) {
  const style = `${FONT_CSS};font-size:${FONT_SIZE};${styleExtra}`;
  return `<p class="MsoNormal" style='${style}'>${inner}</p>`;
}

function cidRef(contentId) {
  return `cid:${contentId}`;
}

function makeContentId(name) {
  return `${name}@${CID_DOMAIN}`;
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
 * SM-005 / template photo table: 1 col × 2 rows, BorderStyle.Single / 0.5pt.
 * Images referenced by cid: (Content-ID), never file:/// or data: URIs —
 * Word treats absolute file:/// img src as external links (dead on open).
 */
function photoTableHtml(imgSrc, caption, index) {
  const cell =
    "border:solid windowtext .5pt;mso-border-alt:solid windowtext .5pt;padding:4.0pt 4.0pt 4.0pt 4.0pt";
  return `
<table class="MsoNormalTable photo-block" border="1" cellspacing="0" cellpadding="0"
  style='border-collapse:collapse;border:none;mso-border-alt:solid windowtext .5pt;width:100%;margin:10.0pt 0;'>
  <tr>
    <td valign="top" style='width:100%;${cell}'>
      <p class="MsoNormal" style='${FONT_CSS};font-size:${FONT_SIZE};margin:0;'>
        <img src="${imgSrc}" alt="photo ${index + 1}" width="520"
          style='width:520px;max-width:100%;height:auto;'/>
      </p>
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
 * Build Word-openable HTML body (no MIME wrapper). Image srcs must be cid:
 * URLs that match Content-ID headers on MHTML parts (not file:/// paths).
 */
export function buildSiteMemoHtml(payload, assetUrls) {
  const locked = config.projectLocked;
  const letterheadSrc = assetUrls.letterhead;
  const photoSrcs = assetUrls.photos || [];
  const copyTo = payload.copy_to ?? "";

  const photoBlocks = Array.isArray(payload.photo_blocks) ? payload.photo_blocks : [];
  const photosHtml = photoBlocks
    .map((block, i) => photoTableHtml(photoSrcs[i], block.caption || "", i))
    .join("\n");

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:w="urn:schemas-microsoft-com:office:word"
xmlns:v="urn:schemas-microsoft-com:vml"
xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta name="ProgId" content="Word.Document">
<meta name="Generator" content="Microsoft Word 15">
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

function mimePart({ contentLocation, contentId, contentType, transferEncoding, body }) {
  const lines = [`--${BOUNDARY}`];
  if (contentLocation) {
    lines.push(`Content-Location: ${contentLocation}`);
  }
  if (contentId) {
    lines.push(`Content-ID: <${contentId}>`);
  }
  lines.push(
    `Content-Transfer-Encoding: ${transferEncoding}`,
    `Content-Type: ${contentType}`,
    "",
    body
  );
  return lines.join("\r\n");
}

/**
 * Pack HTML + binary images as Word-compatible MHTML saved with a `.doc`
 * extension. Images use Content-ID / cid: so Word embeds them instead of
 * following dead file:/// links.
 *
 * Letterhead bytes come from the PNG already inside site-memo-template.doc —
 * not from docs/site-memo-assets/lap-kei-letterhead.png.
 */
export function buildSiteMemoMhtml(payload) {
  const letterheadBuf = extractLetterheadPngFromTemplate(config.templateDoc);
  const letterheadName = "letterhead.png";
  const letterheadCid = makeContentId(letterheadName);
  const letterheadLoc = `${ASSET_DIR}/${letterheadName}`;

  const photoBlocks = Array.isArray(payload.photo_blocks) ? payload.photo_blocks : [];
  const photoAssets = photoBlocks.map((block, i) => {
    const filePath = block.absolutePath;
    const mime = mimeFor(filePath);
    const name = `photo${i}${extForMime(mime)}`;
    return {
      name,
      loc: `${ASSET_DIR}/${name}`,
      cid: makeContentId(name),
      mime,
      buf: fs.readFileSync(filePath),
    };
  });

  const html = buildSiteMemoHtml(payload, {
    letterhead: cidRef(letterheadCid),
    photos: photoAssets.map((a) => cidRef(a.cid)),
  });

  const parts = [];
  parts.push(
    mimePart({
      contentLocation: HTML_LOC,
      contentId: makeContentId("SiteMemo.htm"),
      contentType: 'text/html; charset="utf-8"',
      transferEncoding: "base64",
      body: wrapBase64(Buffer.from(html, "utf8").toString("base64")),
    })
  );
  // Letterhead: template-sourced PNG, cid-addressable (not a site photo block).
  parts.push(
    mimePart({
      contentLocation: letterheadLoc,
      contentId: letterheadCid,
      contentType: "image/png",
      transferEncoding: "base64",
      body: wrapBase64(letterheadBuf.toString("base64")),
    })
  );
  for (const asset of photoAssets) {
    parts.push(
      mimePart({
        contentLocation: asset.loc,
        contentId: asset.cid,
        contentType: asset.mime,
        transferEncoding: "base64",
        body: wrapBase64(asset.buf.toString("base64")),
      })
    );
  }

  const header = [
    "MIME-Version: 1.0",
    `Content-Type: multipart/related; boundary="${BOUNDARY}"; type="text/html"`,
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
