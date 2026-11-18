import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, after } from "node:test";
import { fileURLToPath } from "node:url";
import { createDraftMemo } from "../src/create-draft.js";
import { buildSiteMemoMhtml, writeSiteMemoDoc } from "../src/generate-doc.js";
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

  it("emits Calibri 12, underlined Project/Subject, bordered photos, and sign-off", () => {
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

    // Photo tables Single / 0.5
    assert.match(html, /class="MsoNormalTable photo-block"/);
    assert.match(html, /mso-border-alt:solid windowtext \.5pt/);
    assert.match(html, /Photo of 14\/F Chiller Plant/);

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

    // Two photo parts + letterhead.
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
    assert.doesNotMatch(text, /data:image\//);
    const html = decodeHtmlPart(text);
    assert.match(html, /Yours faithfully,/);
    assert.match(html, /Delivery Note/);
    assert.match(html, /<u><b>Subject:<\/b><\/u>/);
    assert.match(html, /mso-ascii-font-family:Calibri/);
  });
});
