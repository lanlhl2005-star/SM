import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

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

function dataUri(filePath) {
  const buf = fs.readFileSync(filePath);
  return `data:${mimeFor(filePath)};base64,${buf.toString("base64")}`;
}

/**
 * Build an unlocked Word-openable `.doc` (Word HTML) matching
 * docs/site-memo-template.doc layout: letterhead, routing, project/subject/body,
 * N SM-005-style Single/0.5 bordered photo tables, closing/signatory.
 */
export function buildSiteMemoHtml(payload) {
  const locked = config.projectLocked;
  const letterheadUri = dataUri(config.letterhead);

  const bodyItems = Array.isArray(payload.body_items) ? payload.body_items : [];
  const bulletsHtml =
    bodyItems.length > 0
      ? `<ul style="margin:6pt 0 12pt 24pt;padding:0;">
${bodyItems
  .map((item) => {
    if (typeof item === "string") {
      return `  <li style="margin:0 0 4pt 0;font-family:Arial,sans-serif;font-size:11pt;">${nl2br(item)}</li>`;
    }
    const text = item.item_text || item.text || "";
    const reason = item.reason ? `<br/><span>Reason: ${escapeHtml(item.reason)}</span>` : "";
    const num = item.item_number != null ? `${escapeHtml(item.item_number)}) ` : "";
    return `  <li style="margin:0 0 6pt 0;font-family:Arial,sans-serif;font-size:11pt;">${num}${nl2br(text)}${reason}</li>`;
  })
  .join("\n")}
</ul>`
      : "";

  const introHtml = payload.body_intro
    ? `<p style="font-family:Arial,sans-serif;font-size:11pt;margin:0 0 8pt 0;">${nl2br(payload.body_intro)}</p>`
    : "";

  const photoBlocks = Array.isArray(payload.photo_blocks) ? payload.photo_blocks : [];
  const photosHtml = photoBlocks
    .map((block, i) => {
      const imgUri = dataUri(block.absolutePath);
      const caption = block.caption || "";
      return `
<table class="photo-block" border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;border:0.5pt solid windowtext;width:100%;margin:10pt 0;">
  <tr>
    <td valign="top" style="border:0.5pt solid windowtext;padding:4pt;">
      <img src="${imgUri}" alt="photo ${i + 1}" width="520" style="max-width:100%;height:auto;"/>
    </td>
  </tr>
  <tr>
    <td valign="top" style="border:0.5pt solid windowtext;padding:4pt;font-family:Arial,sans-serif;font-size:11pt;">
      ${nl2br(caption)}
    </td>
  </tr>
</table>`;
    })
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
  @page { size: A4; margin: 1.5cm 1.8cm 1.5cm 1.8cm; }
  body { font-family: Arial, "PMingLiU", "SimSun", sans-serif; font-size: 11pt; color: #000; }
  table.routing { width: 100%; border-collapse: collapse; margin: 8pt 0 12pt 0; }
  table.routing td { vertical-align: top; font-size: 11pt; padding: 1pt 4pt 1pt 0; }
  .label-zh { font-family: "PMingLiU", "SimSun", sans-serif; font-size: 10pt; }
  h1.title { text-align: center; font-size: 16pt; font-weight: bold; margin: 8pt 0 12pt 0; }
  .letterhead { width: 100%; max-width: 680px; height: auto; display: block; margin: 0 auto 6pt auto; }
</style>
</head>
<body>
<p style="text-align:center;margin:0;">
  <img class="letterhead" src="${letterheadUri}" alt="Lap Kei Engineering letterhead"/>
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

<p style="margin:10pt 0 6pt 0;font-family:Arial,sans-serif;font-size:11pt;">
  <b>Project:</b> ${escapeHtml(locked.project_title)}
</p>
<p style="margin:0 0 10pt 0;font-family:Arial,sans-serif;font-size:11pt;">
  <b>Subject:</b> ${escapeHtml(payload.subject)}
</p>

${introHtml}
${bulletsHtml}
${photosHtml}

<p style="margin:18pt 0 0 0;font-family:Arial,sans-serif;font-size:11pt;">Yours faithfully,</p>
<p style="margin:0;font-family:Arial,sans-serif;font-size:11pt;">For and on behalf of</p>
<p style="margin:0 0 28pt 0;font-family:Arial,sans-serif;font-size:11pt;">${escapeHtml(locked.closing_company)}</p>
<p style="margin:0;font-family:Arial,sans-serif;font-size:11pt;">${escapeHtml(locked.signatory_name)}</p>
<p style="margin:0;font-family:Arial,sans-serif;font-size:11pt;">${escapeHtml(locked.signatory_title)}</p>
<p style="margin:8pt 0 0 0;font-family:Arial,sans-serif;font-size:10pt;">${escapeHtml(locked.ref_initials)}</p>
</body>
</html>
`;
}

export function writeSiteMemoDoc(outPath, payload) {
  const html = buildSiteMemoHtml(payload);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // UTF-8 BOM helps Word on Windows detect encoding for CJK labels.
  fs.writeFileSync(outPath, `\uFEFF${html}`, "utf8");
  return outPath;
}
