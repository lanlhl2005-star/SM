import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, after } from "node:test";
import { fileURLToPath } from "node:url";
import { createDraftMemo } from "../src/create-draft.js";
import {
  buildSiteMemoMhtml,
  extractLetterheadPngFromTemplate,
  verifyMhtmlImageEmbeds,
  writeSiteMemoDoc,
} from "../src/generate-doc.js";
import { config } from "../src/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function mockPhoto(rel) {
  return path.join(ROOT, "mock", "Group_photo_backup", rel);
}

/** Decode the base64 HTML root part from an MHTML .doc. */
function decodeHtmlPart(mhtml) {
  const htmlPartMatch = mhtml.match(
    /Content-Type: text\/html; charset="utf-8"\r\n\r\n([\s\S]*?)\r\n------=_NextPart_SiteMemo_LK/
  );
  assert.ok(htmlPartMatch, "HTML MIME part present");
  return Buffer.from(htmlPartMatch[1].replace(/\r\n/g, ""), "base64").toString(
    "utf8"
  );
}

describe("generate-doc MHTML site memo", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sm-doc-"));
  const prevSiteRoot = config.siteMemoRoot;

  after(() => {
    config.siteMemoRoot = prevSiteRoot;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("extracts letterhead PNG from site-memo-template.doc (not side asset path)", () => {
    const fromTemplate = extractLetterheadPngFromTemplate(config.templateDoc);
    assert.equal(fromTemplate[0], 0x89);
    assert.equal(fromTemplate[1], 0x50);
    assert.ok(fromTemplate.length > 10_000, "letterhead PNG should be substantial");
    // Generator must not require the side asset file for letterhead bytes.
    assert.ok(fs.existsSync(config.templateDoc));
  });

  it("emits Calibri 12, underlined Project/Subject, Content-Location photos, and sign-off", () => {
    const photoPath = mockPhoto("site-memo/2026-11-18/IMG_chiller_plant.jpg");
    const payload = {
      date: "18/11/2026",
      memo_number: "006",
      copy_to: "",
      subject: "Format match smoke",
      body_intro: "Refer to site inspection, please note the following.",
      body_items: ["Temporary storage area at L1"],
      photo_blocks: [
        {
          image: "site-memo/2026-11-18/IMG_chiller_plant.jpg",
          absolutePath: photoPath,
          caption: "Photo of 14/F Chiller Plant",
        },
        {
          image: "site-memo/2026-11-18/IMG_cooling_tower.jpg",
          absolutePath: mockPhoto("site-memo/2026-11-18/IMG_cooling_tower.jpg"),
          caption: "Photo of R/F Cooling Tower Area (Low Zone)",
        },
      ],
    };

    const mhtml = buildSiteMemoMhtml(payload);
    assert.match(mhtml, /^MIME-Version: 1\.0/);
    assert.match(mhtml, /multipart\/related/);
    assert.match(mhtml, /type="text\/html"/);
    assert.doesNotMatch(mhtml, /data:image\//, "must not use data: URIs (Word truncates)");

    const html = decodeHtmlPart(mhtml);

    // Fonts: Calibri + Word mso-* (never nested double-quotes that break style='')
    assert.match(html, /font-family:Calibri/);
    assert.match(html, /mso-ascii-font-family:Calibri/);
    assert.match(html, /mso-fareast-font-family:PMingLiU/);
    assert.match(html, /font-size:12\.0pt/);
    assert.doesNotMatch(
      html,
      /style="[^"]*font-family:Calibri,\s*"/,
      "inline style must not nest double-quotes inside double-quoted attributes"
    );
    assert.doesNotMatch(
      html,
      /font-family:Calibri,\s*["']/,
      "font-family must not use quoted secondary names that break attributes"
    );

    // Template-like routing (space columns), not an HTML routing table
    assert.match(html, /From/);
    assert.match(html, /Our Ref/);
    assert.doesNotMatch(html, /table class="routing"/);

    // Project / Subject underline
    assert.match(html, /<u><b>Project:<\/b><\/u>/);
    assert.match(html, /<u><b>Subject:<\/b><\/u>/);

    // SM-005 dash bullets (not <ul>)
    assert.match(html, /- Temporary storage area at L1/);
    assert.doesNotMatch(html, /<ul[\s>]/);

    // Photo tables Single / 0.5 — relative SiteMemo_files embeds (Word Content-Location)
    assert.match(html, /class="MsoNormalTable photo-block"/);
    assert.match(html, /mso-border-alt:solid windowtext \.5pt/);
    assert.match(html, /Photo of 14\/F Chiller Plant/);
    assert.match(html, /src="SiteMemo_files\/photo0\.jpg"/);
    assert.match(html, /src="SiteMemo_files\/photo1\.jpg"/);
    assert.match(html, /src="SiteMemo_files\/letterhead\.png"/);
    assert.match(html, /v:imagedata[^>]*src="SiteMemo_files\/letterhead\.png"/);
    assert.doesNotMatch(
      html,
      /(?:src|o:href)="file:\/\//,
      "markup must not use absolute file:/// (Word opens as dead external links)"
    );
    // Primary src must not be cid: — Word desktop MHTML uses Content-Location.
    assert.doesNotMatch(html, /<(?:img|v:imagedata)\b[^>]*\bsrc="cid:/i);

    // MIME parts carry Content-Location matching relative HTML refs
    assert.match(
      mhtml,
      /Content-Location: file:\/\/\/C:\/SiteMemo\/SiteMemo_files\/photo0\.jpg/
    );
    assert.match(
      mhtml,
      /Content-Location: file:\/\/\/C:\/SiteMemo\/SiteMemo_files\/letterhead\.png/
    );
    assert.match(mhtml, /Content-ID: <photo0\.jpg@sitememo\.lk>/);
    assert.match(mhtml, /Content-ID: <letterhead\.png@sitememo\.lk>/);

    // Embed integrity: parts exist, magic bytes OK, HTML refs resolve
    const verified = verifyMhtmlImageEmbeds(mhtml);
    assert.equal(verified.imagePartCount, 3);
    assert.ok(verified.primarySrcs.includes("SiteMemo_files/letterhead.png"));
    assert.ok(verified.primarySrcs.includes("SiteMemo_files/photo0.jpg"));
    assert.ok(verified.primarySrcs.includes("SiteMemo_files/photo1.jpg"));

    // Sign-off after photos
    assert.match(html, /Yours faithfully,/);
    assert.match(html, /For and on behalf of/);
    assert.match(html, /Lap Kei Engineering Co\., Ltd\./);
    assert.match(html, /KS Ho/);
    assert.match(html, /Senior Technical Manager/);
    assert.match(html, /KS\/hc\/yc/);
    assert.ok(
      html.indexOf("Yours faithfully") > html.indexOf("photo-block"),
      "sign-off must follow photo tables"
    );

    // Two photo parts + letterhead Content-Location.
    const photoParts = [
      ...mhtml.matchAll(
        /Content-Location: file:\/\/\/C:\/SiteMemo\/SiteMemo_files\/photo\d+\./g
      ),
    ];
    assert.equal(photoParts.length, 2);

    // No megabyte single lines (Word-hostile).
    const maxLine = Math.max(...mhtml.split(/\r?\n/).map((l) => l.length));
    assert.ok(maxLine <= 100, `max line ${maxLine} should be wrapped (~76)`);

    const out = path.join(tmpRoot, "Site_Memo_LK-P01043-SM-006.doc");
    writeSiteMemoDoc(out, payload);
    assert.ok(fs.existsSync(out));
    const written = fs.readFileSync(out, "utf8");
    assert.match(written, /photo0\.jpg/);
    assert.match(written, /letterhead\.png/);
    const writtenHtml = decodeHtmlPart(written);
    assert.match(writtenHtml, /Yours faithfully,/);
    assert.match(writtenHtml, /Photo of 14\/F Chiller Plant/);
    assert.match(writtenHtml, /src="SiteMemo_files\/photo0\.jpg"/);
    assert.doesNotMatch(writtenHtml, /(?:src|o:href)="file:\/\//);
    verifyMhtmlImageEmbeds(written);
  });

  it("createDraftMemo embeds selected photo_blocks and closing", () => {
    config.siteMemoRoot = tmpRoot;
    const result = createDraftMemo({
      subject: "Notice of Delivery format test",
      short_subject: "format test",
      date: "18/11/2026",
      body_intro: "There are pipes to deliver.",
      body_items: ["Reserving Temporary Storage Area at L1"],
      photo_blocks: [
        {
          image: "site-memo/2026-11-18/IMG_delivery_note.jpg",
          caption: "Delivery Note",
        },
      ],
    });
    assert.equal(result.photo_count, 1);
    const text = fs.readFileSync(result.file_path, "utf8");
    assert.match(text, /MIME-Version/);
    assert.match(text, /photo0\.jpg/);
    assert.match(
      text,
      /Content-Location: file:\/\/\/C:\/SiteMemo\/SiteMemo_files\/photo0\.jpg/
    );
    assert.doesNotMatch(text, /data:image\//);
    const html = decodeHtmlPart(text);
    assert.match(html, /Yours faithfully,/);
    assert.match(html, /Delivery Note/);
    assert.match(html, /<u><b>Subject:<\/b><\/u>/);
    assert.match(html, /mso-ascii-font-family:Calibri/);
    assert.match(html, /src="SiteMemo_files\/photo0\.jpg"/);
    assert.doesNotMatch(html, /(?:src|o:href)="file:\/\//);
    verifyMhtmlImageEmbeds(text);
  });

  it("rejects SM-008-style cid-primary markup in verifier", () => {
    // Mimic broken PR #14 pattern: cid: primary src with matching Content-ID.
    const fake = [
      "MIME-Version: 1.0",
      `Content-Type: multipart/related; boundary="----=_NextPart_SiteMemo_LK"; type="text/html"`,
      "",
      "------=_NextPart_SiteMemo_LK",
      "Content-Location: file:///C:/SiteMemo/SiteMemo.htm",
      'Content-Transfer-Encoding: base64',
      'Content-Type: text/html; charset="utf-8"',
      "",
      Buffer.from(
        '<html><img src="cid:letterhead.png@sitememo.lk"/></html>',
        "utf8"
      )
        .toString("base64")
        .match(/.{1,76}/g)
        .join("\r\n"),
      "------=_NextPart_SiteMemo_LK",
      "Content-Location: file:///C:/SiteMemo/SiteMemo_files/letterhead.png",
      "Content-ID: <letterhead.png@sitememo.lk>",
      "Content-Transfer-Encoding: base64",
      "Content-Type: image/png",
      "",
      // Minimal valid-ish PNG header bytes as base64 (not a full PNG — magic check)
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        .toString("base64"),
      "------=_NextPart_SiteMemo_LK--",
      "",
    ].join("\r\n");

    assert.throws(
      () => verifyMhtmlImageEmbeds(fake),
      /primary src must be relative/
    );
  });
});
