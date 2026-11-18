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
/** HTML root label — Word resolves relative img src against this directory. */
const HTML_LOC = "file:///C:/SiteMemo/SiteMemo.htm";
/** Absolute Content-Location prefix for image MIME parts (Word MHTML style). */
const ASSET_DIR_ABS = "file:///C:/SiteMemo/SiteMemo_files";
/**
 * Relative path prefix used in HTML/VML src. Must resolve against HTML_LOC to
 * the same URI as each image part's Content-Location. Word desktop embeds via
 * Content-Location matching — not cid: (email-oriented) and not absolute
 * file:/// img src (treated as dead disk links).
 */
const ASSET_DIR_REL = "SiteMemo_files";
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

function makeContentId(name) {
  return `${name}@${CID_DOMAIN}`;
}

function relativeAssetRef(name) {
  return `${ASSET_DIR_REL}/${name}`;
}

function absoluteAssetLoc(name) {
  return `${ASSET_DIR_ABS}/${name}`;
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
 * Word-native embedded image: VML imagedata (Print/layout) + fallback <img>.
 * Both use relative SiteMemo_files/... paths that match Content-Location parts.
 * o:href keeps a cid: secondary for agents that prefer Content-ID.
 */
function embeddedImageHtml({ relSrc, cid, widthPx, alt, shapeId }) {
  const widthPt = Math.round(widthPx * 0.75 * 100) / 100;
  const safeAlt = escapeHtml(alt);
  return `<!--[if gte vml 1]><v:shape id="${shapeId}" type="#_x0000_t75" alt="${safeAlt}"
 style='width:${widthPt}pt' o:allowoverlap="f">
 <v:imagedata src="${relSrc}" o:href="cid:${cid}" o:title="${safeAlt}"/>
</v:shape><![endif]--><![if !vml]><img width="${widthPx}" src="${relSrc}"
 alt="${safeAlt}" style='width:${widthPx}px;max-width:100%;height:auto;'
 v:shapes="${shapeId}"/><![endif]>`;
}

/**
 * SM-005 / template photo table: 1 col × 2 rows, BorderStyle.Single / 0.5pt.
 * Images use relative SiteMemo_files/ refs (Word Content-Location embeds).
 */
function photoTableHtml(imgMeta, caption, index) {
  const cell =
    "border:solid windowtext .5pt;mso-border-alt:solid windowtext .5pt;padding:4.0pt 4.0pt 4.0pt 4.0pt";
  const image = embeddedImageHtml({
    relSrc: imgMeta.relSrc,
    cid: imgMeta.cid,
    widthPx: 520,
    alt: `photo ${index + 1}`,
    shapeId: `_x0000_i${1026 + index}`,
  });
  return `
<table class="MsoNormalTable photo-block" border="1" cellspacing="0" cellpadding="0"
  style='border-collapse:collapse;border:none;mso-border-alt:solid windowtext .5pt;width:100%;margin:10.0pt 0;'>
  <tr>
    <td valign="top" style='width:100%;${cell}'>
      <p class="MsoNormal" style='${FONT_CSS};font-size:${FONT_SIZE};margin:0;'>
        ${image}
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
 * Build Word-openable HTML body (no MIME wrapper). Image srcs must be relative
 * SiteMemo_files/... paths that match Content-Location on MHTML parts.
 */
export function buildSiteMemoHtml(payload, assetUrls) {
  const locked = config.projectLocked;
  const letterhead = assetUrls.letterhead;
  const photoSrcs = assetUrls.photos || [];
  const copyTo = payload.copy_to ?? "";

  const photoBlocks = Array.isArray(payload.photo_blocks) ? payload.photo_blocks : [];
  const photosHtml = photoBlocks
    .map((block, i) => photoTableHtml(photoSrcs[i], block.caption || "", i))
    .join("\n");

  const letterheadHtml = embeddedImageHtml({
    relSrc: letterhead.relSrc,
    cid: letterhead.cid,
    widthPx: 640,
    alt: "Lap Kei Engineering letterhead",
    shapeId: "_x0000_i1025",
  });

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
<!--[if gte vml 1]>
<xml>
  <o:shapelayout v:ext="edit">
   <o:idmap v:ext="edit" data="1"/>
  </o:shapelayout>
  <v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75"
   o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f">
   <v:stroke joinstyle="miter"/>
   <v:formulas>
    <v:f eqn="if lineDrawn pixelLineWidth 0"/>
    <v:f eqn="sum @0 1 0"/>
    <v:f eqn="sum 0 0 @1"/>
    <v:f eqn="prod @2 1 2"/>
    <v:f eqn="prod @3 21600 pixelWidth"/>
    <v:f eqn="prod @3 21600 pixelHeight"/>
    <v:f eqn="sum @0 0 1"/>
    <v:f eqn="prod @6 1 2"/>
    <v:f eqn="prod @7 21600 pixelWidth"/>
    <v:f eqn="sum @8 21600 0"/>
    <v:f eqn="prod @7 21600 pixelHeight"/>
    <v:f eqn="sum @10 21600 0"/>
   </v:formulas>
   <v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/>
   <o:lock v:ext="edit" aspectratio="t"/>
  </v:shapetype>
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
  ${letterheadHtml}
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
 * extension. Images are referenced by relative SiteMemo_files/ paths that
 * match each part's Content-Location (Word's native MHTML embedding).
 * Content-ID / cid: is retained only as a secondary VML o:href label.
 *
 * Letterhead bytes come from the PNG already inside site-memo-template.doc —
 * not from docs/site-memo-assets/lap-kei-letterhead.png.
 */
export function buildSiteMemoMhtml(payload) {
  const letterheadBuf = extractLetterheadPngFromTemplate(config.templateDoc);
  const letterheadName = "letterhead.png";
  const letterheadCid = makeContentId(letterheadName);
  const letterheadRel = relativeAssetRef(letterheadName);
  const letterheadLoc = absoluteAssetLoc(letterheadName);

  const photoBlocks = Array.isArray(payload.photo_blocks) ? payload.photo_blocks : [];
  const photoAssets = photoBlocks.map((block, i) => {
    const filePath = block.absolutePath;
    const mime = mimeFor(filePath);
    const name = `photo${i}${extForMime(mime)}`;
    return {
      name,
      relSrc: relativeAssetRef(name),
      loc: absoluteAssetLoc(name),
      cid: makeContentId(name),
      mime,
      buf: fs.readFileSync(filePath),
    };
  });

  const html = buildSiteMemoHtml(payload, {
    letterhead: { relSrc: letterheadRel, cid: letterheadCid },
    photos: photoAssets.map((a) => ({ relSrc: a.relSrc, cid: a.cid })),
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
  // Letterhead: template-sourced PNG, Content-Location embedded (not a site photo).
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

/**
 * Parse MHTML image parts and verify each HTML/VML image ref resolves to a
 * base64 part with valid image magic bytes. Used by tests / smoke checks.
 */
export function verifyMhtmlImageEmbeds(mhtml) {
  const boundaryRe = new RegExp(
    `^--${BOUNDARY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?\\r?\\n`,
    "m"
  );
  const rawParts = mhtml.split(boundaryRe).slice(1);
  const imageParts = new Map();
  let html = null;

  for (const raw of rawParts) {
    if (!raw.trim() || raw.startsWith("--")) continue;
    const sep = raw.indexOf("\r\n\r\n");
    if (sep < 0) continue;
    const headers = raw.slice(0, sep);
    const body = raw.slice(sep + 4).replace(/\r\n--[\s\S]*$/, "").trim();
    const locMatch = headers.match(/Content-Location:\s*(\S+)/i);
    const typeMatch = headers.match(/Content-Type:\s*([^\r\n;]+)/i);
    const encMatch = headers.match(/Content-Transfer-Encoding:\s*(\S+)/i);
    const loc = locMatch ? locMatch[1] : "";
    const type = typeMatch ? typeMatch[1].trim().toLowerCase() : "";
    const enc = encMatch ? encMatch[1].toLowerCase() : "";
    if (type.startsWith("text/html")) {
      const bytes =
        enc === "base64"
          ? Buffer.from(body.replace(/\r?\n/g, ""), "base64")
          : Buffer.from(body, "utf8");
      html = bytes.toString("utf8");
      continue;
    }
    if (!type.startsWith("image/")) continue;
    const bytes =
      enc === "base64"
        ? Buffer.from(body.replace(/\r?\n/g, ""), "base64")
        : Buffer.from(body, "binary");
    const name = loc.split("/").pop();
    imageParts.set(loc, { type, bytes, name });
    if (name) imageParts.set(`${ASSET_DIR_REL}/${name}`, { type, bytes, name });
  }

  if (!html) {
    throw new Error("MHTML missing HTML root part");
  }

  const refs = [
    ...html.matchAll(/(?:src|o:href)=["']([^"']+)["']/gi),
  ].map((m) => m[1]);

  const imageRefs = refs.filter(
    (r) =>
      r.includes("SiteMemo_files/") ||
      r.startsWith("cid:") ||
      r.startsWith("file:") ||
      r.startsWith("data:")
  );

  if (imageRefs.length === 0) {
    throw new Error("HTML has no image references");
  }

  const problems = [];
  for (const ref of imageRefs) {
    if (ref.startsWith("file:")) {
      problems.push(`absolute file URL in markup (dead disk link): ${ref}`);
      continue;
    }
    if (ref.startsWith("data:")) {
      problems.push(`data: URI in markup (Word truncates): ${ref.slice(0, 32)}…`);
      continue;
    }
    if (ref.startsWith("cid:")) {
      // Secondary VML o:href only — primary src must still be relative.
      continue;
    }
    if (!ref.startsWith(`${ASSET_DIR_REL}/`)) {
      problems.push(`unexpected image ref (want ${ASSET_DIR_REL}/…): ${ref}`);
      continue;
    }
    const part =
      imageParts.get(ref) ||
      imageParts.get(`${ASSET_DIR_ABS}/${ref.slice(ASSET_DIR_REL.length + 1)}`);
    if (!part) {
      problems.push(`no MIME part for ${ref}`);
      continue;
    }
    if (part.bytes.length < 32) {
      problems.push(`image part too small for ${ref}: ${part.bytes.length} bytes`);
      continue;
    }
    const isPng =
      part.bytes[0] === 0x89 &&
      part.bytes[1] === 0x50 &&
      part.bytes[2] === 0x4e &&
      part.bytes[3] === 0x47;
    const isJpeg = part.bytes[0] === 0xff && part.bytes[1] === 0xd8;
    const isGif =
      part.bytes[0] === 0x47 && part.bytes[1] === 0x49 && part.bytes[2] === 0x46;
    if (!isPng && !isJpeg && !isGif) {
      problems.push(`bad image magic for ${ref}`);
    }
  }

  // Primary <img src> / v:imagedata src must be relative (not cid:/file:).
  const primarySrcs = [
    ...html.matchAll(/<(?:img|v:imagedata)\b[^>]*?\bsrc=["']([^"']+)["']/gi),
  ].map((m) => m[1]);
  for (const src of primarySrcs) {
    if (!src.startsWith(`${ASSET_DIR_REL}/`)) {
      problems.push(`primary src must be relative ${ASSET_DIR_REL}/…, got ${src}`);
    }
  }

  if (problems.length) {
    throw new Error(`MHTML image embed check failed:\n- ${problems.join("\n- ")}`);
  }

  return {
    html,
    imagePartCount: [...imageParts.keys()].filter((k) => k.startsWith("file:")).length,
    primarySrcs,
  };
}

export function writeSiteMemoDoc(outPath, payload) {
  const mhtml = buildSiteMemoMhtml(payload);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // MHTML is ASCII headers + base64; write as binary-safe utf8 (no BOM).
  fs.writeFileSync(outPath, mhtml, "utf8");
  return outPath;
}
