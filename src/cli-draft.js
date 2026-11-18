#!/usr/bin/env node
/**
 * Headless Draft create for smoke tests / automation.
 * Usage:
 *   node src/cli-draft.js --subject "Test diversion" --image 2026-11-18/IMG_chiller_plant.jpg
 */
import { createDraftMemo } from "./create-draft.js";
import { config } from "./config.js";

function parseArgs(argv) {
  const out = { images: [], captions: [], body_items: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--subject") out.subject = argv[++i];
    else if (a === "--short") out.short_subject = argv[++i];
    else if (a === "--date") out.date = argv[++i];
    else if (a === "--intro") out.body_intro = argv[++i];
    else if (a === "--bullet") out.body_items.push(argv[++i]);
    else if (a === "--image") out.images.push(argv[++i]);
    else if (a === "--caption") out.captions.push(argv[++i]);
    else if (a === "--copy-to") out.copy_to = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.subject || !args.images.length) {
  console.error(
    "Required: --subject <text> --image <day/file> [--caption <text>] [--intro ...] [--bullet ...]"
  );
  process.exit(1);
}

const photo_blocks = args.images.map((image, i) => ({
  image,
  caption: args.captions[i] || `Photo ${i + 1}`,
}));

const result = createDraftMemo({
  subject: args.subject,
  short_subject: args.short_subject,
  date: args.date,
  body_intro: args.body_intro,
  body_items: args.body_items,
  copy_to: args.copy_to ?? "",
  photo_blocks,
});

console.log(JSON.stringify({ useMock: config.useMock, ...result }, null, 2));
