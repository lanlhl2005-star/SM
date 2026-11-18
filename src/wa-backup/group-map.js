/**
 * Resolve Group_photo_backup folder from live WhatsApp chat context.
 * Groups → sanitized group subject; 1:1 → "individual".
 * No keyword / alias mapping.
 */

import { sanitizeFolderName } from "./naming.js";

export const INDIVIDUAL_FOLDER = "individual";

/**
 * @param {object} opts
 * @param {boolean} opts.isGroup
 * @param {string|null|undefined} opts.subject  WhatsApp group display name
 * @param {string} [opts.individualFolder]
 * @returns {{ folder: string, reason: string }}
 */
export function resolveBackupFolder({
  isGroup,
  subject,
  individualFolder = INDIVIDUAL_FOLDER,
} = {}) {
  const individual = sanitizeFolderName(individualFolder) || INDIVIDUAL_FOLDER;

  if (!isGroup) {
    return {
      folder: individual,
      reason: "1:1 chat — using individual folder",
    };
  }

  const folder = sanitizeFolderName(subject);
  if (!folder) {
    return {
      folder: individual,
      reason: "empty or unsanitizable group subject — using individual folder",
    };
  }

  return {
    folder,
    reason: `group subject "${subject}" → folder "${folder}"`,
  };
}

/** @deprecated Use resolveBackupFolder. Kept name for call-site clarity in logs. */
export function mapSubjectToFolder(subject, individualFolder = INDIVIDUAL_FOLDER) {
  return resolveBackupFolder({
    isGroup: true,
    subject,
    individualFolder,
  });
}
