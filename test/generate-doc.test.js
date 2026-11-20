import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, after } from "node:test";
import { fileURLToPath } from "node:url";
import { createDraftMemo } from "../src/create-draft.js";
import {
  buildSiteMemoHtml,
  extractLetterheadPngFromTemplate,
  photoDisplaySize,
  verifyWordHtmlImageEmbeds,
  writeSiteMemoDoc,
} from "../src/generate-doc.js";
import { config } from "../src/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function mockPhoto(rel) {
  return path.join(ROOT, "mock", "Group_photo_backup", rel);
}

describe("generate-doc Word HTML site memo (data: URI embeds)", () => {
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
    assert.ok(fs.existsSync(config.templateDoc));
  });

  it("emits Calibri 12, underlined Project/Subject, data: URI photos, and sign-off", () => {
    const photoPath = mockPhoto("site-memo/2026-11-18/IMG_chiller_plant.jpg");
    const payload = {
      date: "18/11/2026",
      memo_number: "010",
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

    const html = buildSiteMemoHtml(payload);
    assert.doesNotMatch(html, /^MIME-Version:/m);
    assert.doesNotMatch(html, /multipart\/related/);
    assert.doesNotMatch(html, /SiteMemo_files\//);
    assert.doesNotMatch(html, /\bsrc=["']cid:/i);
    assert.doesNotMatch(html, /\bsrc=["']file:/i);

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

    // Photo tables Single / 0.5 — data: URI embeds, display-capped (not full-page 520px)
    assert.match(html, /class="MsoNormalTable photo-block"/);
    assert.match(html, /mso-border-alt:solid windowtext \.5pt/);
    assert.match(html, /Photo of 14\/F Chiller Plant/);
    assert.match(html, /data:image\/png;base64,/);
    assert.match(html, /data:image\/jpeg;base64,/);
    const single = photoDisplaySize(1);
    assert.match(
      html,
      new RegExp(`width="${single.px}"[^>]*style='width:${single.cm}cm`)
    );
    assert.doesNotMatch(html, /width="520"/);
    assert.ok(single.cm >= 5 && single.cm <= 7, "single photo ~5–7cm print width");

    const verified = verifyWordHtmlImageEmbeds(html);
    assert.equal(verified.imageCount, 3, "letterhead + 2 photos");
    assert.ok(verified.letterheadBytes > 10_000);
    assert.equal(verified.photoBytes.length, 2);
    assert.ok(verified.photoBytes.every((n) => n > 1000));
    // Full original JPEG bytes embedded (display size does not downsample).
    const fileBytes = fs.statSync(photoPath).size;
    assert.ok(
      verified.photoBytes[0] >= fileBytes * 0.95,
      "embedded photo bytes ≈ original file (no downsample)"
    );

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

    const out = path.join(tmpRoot, "Site_Memo_LK-P01043-SM-010.doc");
    writeSiteMemoDoc(out, payload);
    assert.ok(fs.existsSync(out));
    const written = fs.readFileSync(out, "utf8");
    assert.equal(written.charCodeAt(0), 0xfeff, "UTF-8 BOM for Word CJK");
    assert.match(written, /data:image\/png;base64,/);
    assert.match(written, /data:image\/jpeg;base64,/);
    assert.match(written, /Yours faithfully,/);
    assert.match(written, /Photo of 14\/F Chiller Plant/);
    verifyWordHtmlImageEmbeds(written);
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
    assert.doesNotMatch(text, /MIME-Version/);
    assert.match(text, /data:image\/jpeg;base64,/);
    assert.match(text, /data:image\/png;base64,/);
    assert.match(text, /Yours faithfully,/);
    assert.match(text, /Delivery Note/);
    assert.match(text, /<u><b>Subject:<\/b><\/u>/);
    assert.match(text, /mso-ascii-font-family:Calibri/);
    const verified = verifyWordHtmlImageEmbeds(text);
    assert.equal(verified.imageCount, 2);
  });

  it("multi-photo block: one border, one caption, display-capped grid", () => {
    const a = mockPhoto("site-memo/2026-11-18/IMG_chiller_plant.jpg");
    const b = mockPhoto("site-memo/2026-11-18/IMG_cooling_tower.jpg");
    const c = mockPhoto("site-memo/2026-11-18/IMG_corridor.jpg");
    const payload = {
      date: "20/11/2026",
      memo_number: "020",
      copy_to: "",
      subject: "Multi-photo caption group",
      body_intro: "Grouped site photos.",
      body_items: ["Check routing"],
      photo_blocks: [
        {
          image: "site-memo/2026-11-18/IMG_chiller_plant.jpg",
          images: [
            "site-memo/2026-11-18/IMG_chiller_plant.jpg",
            "site-memo/2026-11-18/IMG_cooling_tower.jpg",
            "site-memo/2026-11-18/IMG_corridor.jpg",
          ],
          absolutePath: a,
          absolutePaths: [a, b, c],
          caption: "Chiller / cooling / corridor",
        },
      ],
    };

    const html = buildSiteMemoHtml(payload);
    assert.equal(
      (html.match(/class="MsoNormalTable photo-block"/g) || []).length,
      1,
      "one bordered block for the group"
    );
    assert.match(html, /class="MsoNormalTable photo-row"/);
    assert.match(html, /Chiller \/ cooling \/ corridor/);
    assert.equal(
      (html.match(/Chiller \/ cooling \/ corridor/g) || []).length,
      1,
      "single shared caption"
    );

    const grid = photoDisplaySize(3);
    assert.match(
      html,
      new RegExp(`width="${grid.px}"[^>]*style='width:${grid.cm}cm`)
    );

    const verified = verifyWordHtmlImageEmbeds(html);
    assert.equal(verified.imageCount, 4, "letterhead + 3 photos");
    assert.ok(verified.photoBytes.every((n) => n > 1000));
  });

  it("createDraftMemo accepts images[] multi-photo block", () => {
    config.siteMemoRoot = tmpRoot;
    const result = createDraftMemo({
      subject: "Multi image draft",
      short_subject: "multi image",
      date: "20/11/2026",
      body_intro: "Grouped.",
      body_items: ["Item"],
      photo_blocks: [
        {
          images: [
            "site-memo/2026-11-18/IMG_chiller_plant.jpg",
            "site-memo/2026-11-18/IMG_delivery_note.jpg",
          ],
          caption: "Plant and delivery",
        },
      ],
    });
    assert.equal(result.photo_count, 1, "one block even with two images");
    const text = fs.readFileSync(result.file_path, "utf8");
    assert.match(text, /Plant and delivery/);
    assert.match(text, /photo-row/);
    const verified = verifyWordHtmlImageEmbeds(text);
    assert.equal(verified.imageCount, 3, "letterhead + 2 photos");
  });

  it("rejects MHTML / relative / cid strategies in verifier", () => {
    assert.throws(
      () =>
        verifyWordHtmlImageEmbeds(
          'MIME-Version: 1.0\nContent-Type: multipart/related\n<img src="SiteMemo_files/photo0.jpg"/>'
        ),
      /MHTML|SiteMemo_files|data:image/
    );
    assert.throws(
      () =>
        verifyWordHtmlImageEmbeds(
          '<html><img src="cid:letterhead.png@sitememo.lk"/></html>'
        ),
      /cid:|data:image/
    );
    assert.throws(
      () =>
        verifyWordHtmlImageEmbeds(
          '<html><img src="file:///C:/SiteMemo/SiteMemo_files/photo0.jpg"/></html>'
        ),
      /file:|data:image/
    );
  });

});
