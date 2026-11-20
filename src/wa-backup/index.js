#!/usr/bin/env node
/**
 * Baileys linked-device WhatsApp photo + PDF backup for Site Memo.
 *
 * Primary path: link once on a Windows PC, then run the daemon.
 * Saves incoming photos and PDFs into PHOTO_BACKUP_ROOT\<group-or-individual>\YYYY-MM-DD\.
 * Tags each file (sender, send date, nearby caption ±5 min) via .tags.json sidecars.
 * Group folders use the live WhatsApp group subject (sanitized); 1:1 → individual.
 * Does NOT send messages. Phone stays primary; Desktop daily use undisturbed.
 *
 * Patterns adapted from https://github.com/lanlhl2005-star/whatsapp-media-saver
 *
 * Usage:
 *   npm run wa-link
 *   npm run wa-backup
 *   npm run wa-backup:health
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { logger } from "./logger.js";
import { DEFAULT_LINK_TIMEOUT_MS, parseLinkArgs } from "./link-args.js";
import { checkHeartbeat, touchHeartbeat } from "./heartbeat.js";
import { loadState, saveState } from "./state.js";
import { INDIVIDUAL_FOLDER } from "./group-map.js";
import {
  createSocket,
  DisconnectReason,
  getDisconnectStatusCode,
  shouldReconnectAfterClose,
} from "./session.js";
import { createPipeline } from "./pipeline.js";

const COMMANDS = ["link", "run", "health", "help"];
const LINK_HEARTBEAT_MS = 30_000;

function baileys() {
  return config.whatsappBaileys;
}

function printHelp() {
  const b = baileys();
  console.log(`Site Memo — WhatsApp Baileys linked-device photo + PDF backup

Usage:
  node src/wa-backup/index.js <command> [options]
  npm run wa-link | wa-backup | wa-backup:health

Commands:
  link      Pair once (QR and/or pairing code). Persist auth and exit when connected.
  run       Long-lived daemon: save incoming photos + PDFs under PHOTO_BACKUP_ROOT.
  health    Exit 0 if daemon heartbeat is fresh; else exit 1.
  help      Show this help.

Link options:
  --phone <E.164 digits>   Pairing code instead of (or with) QR
                           e.g. npm run wa-link -- --phone 85291234567
  --timeout-ms <n>         Max wait for first open (default ${DEFAULT_LINK_TIMEOUT_MS})

Layout:
  <PHOTO_BACKUP_ROOT>\\<WhatsApp group subject>\\YYYY-MM-DD\\<file>
  1:1 chats → <PHOTO_BACKUP_ROOT>\\${b.individualFolder || INDIVIDUAL_FOLDER}\\YYYY-MM-DD\\

Safety:
  Linked-device only — phone stays primary; Desktop daily use undisturbed.
  Incoming media only — does NOT send messages.
  Run "link" on your Windows PC (not on a cloud VM / this agent).
  Need a spare Linked devices slot. Status 515 during pairing is normal.
`);
}

function ensureBackupRoots() {
  const b = baileys();
  fs.mkdirSync(config.photoBackupRoot, { recursive: true });
  // Group subject folders are created on demand; pre-create individual only.
  const individual = b.individualFolder || INDIVIDUAL_FOLDER;
  fs.mkdirSync(path.join(config.photoBackupRoot, individual), {
    recursive: true,
  });
}

function ensureTmpDir() {
  const tmpDir = baileys().tmpDir;
  fs.mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

async function cmdLink(linkOpts = {}) {
  const b = baileys();
  const { phone = null, timeoutMs = DEFAULT_LINK_TIMEOUT_MS } = linkOpts;
  const qrImagePath = path.join(b.authDir, "qr.png");

  logger.info(
    {
      authDir: b.authDir,
      qrImagePath,
      pairingPhone: phone || undefined,
      timeoutMs,
    },
    phone ? "Starting link (pairing-code) flow" : "Starting link (QR) flow"
  );

  if (!phone) {
    logger.info(
      "Tip: open Linked devices on the phone first, then scan quickly when a NEW QR appears. If you see 515, wait — a fresh QR will print. Or use: npm run wa-link -- --phone 852xxxxxxxx"
    );
  } else {
    logger.info(
      { phone },
      "Will request a pairing code after WhatsApp connects (Linked devices → Link with phone number)"
    );
  }

  let sockRef = null;
  let reconnecting = false;
  let settled = false;
  let pairingRequestedForSock = false;

  const shutdownSock = () => {
    try {
      sockRef?.end?.(undefined);
    } catch {
      /* ignore */
    }
  };

  const onSigint = () => {
    if (settled) return;
    settled = true;
    logger.info(
      "Link cancelled (Ctrl+C). Auth left as-is — rerun wa-link when ready."
    );
    shutdownSock();
    process.exit(130);
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigint);

  try {
    await new Promise((resolve, reject) => {
      const startedAt = Date.now();

      const heartbeat = setInterval(() => {
        if (settled) return;
        const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
        const remainSec = Math.max(
          0,
          Math.round((timeoutMs - (Date.now() - startedAt)) / 1000)
        );
        logger.info(
          { elapsedSec, remainSec, qrImagePath },
          "Still waiting for WhatsApp link — scan the latest QR (or enter pairing code); 515 reconnects are normal"
        );
      }, LINK_HEARTBEAT_MS);

      const timer = setTimeout(() => {
        finish(
          reject,
          new Error(
            `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for WhatsApp connection / QR scan`
          )
        );
      }, timeoutMs);

      function finish(fn, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(heartbeat);
        fn(value);
      }

      const connect = async () => {
        pairingRequestedForSock = false;
        const { sock } = await createSocket({
          authDir: b.authDir,
          logger,
          printQr: true,
          qrImagePath,
          onConnectionUpdate: (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (
              phone &&
              !pairingRequestedForSock &&
              !sock.authState?.creds?.registered &&
              (qr || connection === "connecting")
            ) {
              pairingRequestedForSock = true;
              sock
                .requestPairingCode(phone)
                .then((code) => {
                  const formatted = String(code)
                    .replace(/(.{4})/g, "$1-")
                    .replace(/-$/, "");
                  logger.info(
                    { code, formatted },
                    "Enter this pairing code on the phone: WhatsApp → Linked devices → Link with phone number"
                  );
                  console.log(`\n  Pairing code: ${formatted}\n`);
                })
                .catch((err) => {
                  pairingRequestedForSock = false;
                  logger.error(
                    { err: err.message },
                    "requestPairingCode failed — will retry on next QR"
                  );
                });
            }

            if (connection === "open") {
              finish(resolve, { connected: true });
              return;
            }

            if (connection === "close") {
              const statusCode = getDisconnectStatusCode(lastDisconnect);
              if (!shouldReconnectAfterClose(statusCode)) {
                logger.error(
                  "Logged out during link. Delete/quarantine .wa-auth/ then run wa-link again."
                );
                finish(
                  reject,
                  new Error("Logged out — delete .wa-auth/ and run wa-link again")
                );
                return;
              }

              const restartRequired =
                statusCode === DisconnectReason.restartRequired ||
                statusCode === 515;
              const delay = restartRequired ? 0 : 1_500;
              if (reconnecting || settled) return;
              reconnecting = true;
              logger.info(
                { statusCode, delay },
                restartRequired
                  ? "515 restart required — reconnecting now (expect a fresh QR if still unpaired)"
                  : "Transient disconnect during link — reconnecting…"
              );
              setTimeout(() => {
                reconnecting = false;
                if (settled) return;
                connect().catch((err) => finish(reject, err));
              }, delay);
            }
          },
        });
        sockRef = sock;
      };

      connect().catch((err) => finish(reject, err));
    });

    logger.info(
      "Linked successfully. Credentials saved under .wa-auth/. You can close this and run: npm run wa-backup"
    );
    try {
      fs.unlinkSync(qrImagePath);
    } catch {
      /* optional cleanup */
    }
    shutdownSock();
    await new Promise((r) => setTimeout(r, 500));
    process.exit(0);
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigint);
  }
}

async function cmdRun() {
  const b = baileys();
  const authCreds = path.join(b.authDir, "creds.json");
  if (!fs.existsSync(authCreds)) {
    logger.error(
      "No .wa-auth/creds.json — run `npm run wa-link` on this Windows PC first."
    );
    process.exit(1);
  }

  ensureBackupRoots();
  const tmpDir = ensureTmpDir();
  const state = loadState(b.stateFile);

  let restarting = false;
  let heartbeatTimer;
  let sockRef;
  let pipeline;

  logger.info("Site Memo WhatsApp Baileys → Group_photo_backup daemon");
  logger.info(`  USE_MOCK=${config.useMock}`);
  logger.info(`  backup: ${config.photoBackupRoot}`);
  logger.info(`  auth:   ${b.authDir}`);
  logger.info(
    `  folders: <group subject>/YYYY-MM-DD/ or ${b.individualFolder || INDIVIDUAL_FOLDER}/YYYY-MM-DD/`
  );
  logger.info(`  mediaTypes: ${(b.mediaTypes || ["image"]).join(", ")}`);
  logger.info("  (linked-device; incoming only; no WhatsApp send)");

  const start = async () => {
    const { sock } = await createSocket({
      authDir: b.authDir,
      logger,
      printQr: true,
      qrImagePath: path.join(b.authDir, "qr.png"),
      onConnectionUpdate: async (update) => {
        if (update.connection === "close") {
          const code = getDisconnectStatusCode(update.lastDisconnect);
          const loggedOut = code === DisconnectReason.loggedOut;
          if (loggedOut) {
            logger.error(
              "Session logged out. Stopped auto-reconnect. Delete or quarantine .wa-auth/ then run wa-link again."
            );
            clearInterval(heartbeatTimer);
            pipeline?.flush();
            process.exitCode = 2;
            return;
          }
          if (!restarting) {
            restarting = true;
            const restartRequired =
              code === DisconnectReason.restartRequired || code === 515;
            const delay = restartRequired ? 0 : 5_000;
            logger.warn(
              { delay, statusCode: code },
              restartRequired
                ? "515 restart required — reconnecting immediately…"
                : "Reconnecting…"
            );
            setTimeout(() => {
              restarting = false;
              start().catch((err) => {
                logger.error({ err: err.message }, "reconnect failed");
                process.exit(1);
              });
            }, delay);
          }
        }
        if (update.connection === "open") {
          touchHeartbeat(b.heartbeatPath, {
            mode: "run",
            connection: "open",
          });
        }
      },
    });
    sockRef = sock;

    pipeline = createPipeline({
      baileysCfg: b,
      photoBackupRoot: config.photoBackupRoot,
      state,
      stateFile: b.stateFile,
      sock,
      logger,
      tmpDir,
    });
    pipeline.attach();

    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      pipeline.touch({ connection: "open" });
    }, 30_000);

    touchHeartbeat(b.heartbeatPath, { mode: "run", connection: "starting" });
    logger.info(
      "Daemon running — incoming photos + PDFs will be saved with tags. Ctrl+C to stop."
    );
  };

  const shutdown = () => {
    logger.info("Shutting down…");
    clearInterval(heartbeatTimer);
    try {
      pipeline?.flush();
    } catch {
      /* ignore */
    }
    try {
      sockRef?.end?.(undefined);
    } catch {
      /* ignore */
    }
    try {
      saveState(b.stateFile, state);
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await start();
}

function cmdHealth() {
  const b = baileys();
  const result = checkHeartbeat(b.heartbeatPath, b.heartbeatStaleMs);
  if (result.ok) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          ageMs: result.ageMs,
          pid: result.heartbeat?.pid,
          iso: result.heartbeat?.iso,
        },
        null,
        2
      )
    );
    process.exit(0);
  }
  console.error(
    JSON.stringify(
      {
        ok: false,
        reason: result.reason,
        ageMs: result.ageMs,
        heartbeat: result.heartbeat,
      },
      null,
      2
    )
  );
  process.exit(1);
}

async function main() {
  const cmd = (process.argv[2] || "help").toLowerCase();
  if (!COMMANDS.includes(cmd) || cmd === "help") {
    printHelp();
    process.exit(cmd === "help" || !process.argv[2] ? 0 : 1);
  }

  const rest = process.argv.slice(3);
  if (cmd === "link") return cmdLink(parseLinkArgs(rest));
  if (cmd === "run") return cmdRun();
  if (cmd === "health") return cmdHealth();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
