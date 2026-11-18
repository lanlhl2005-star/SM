/**
 * Map WhatsApp group subject → configured Group_photo_backup folder key.
 * Uses matchNames / matchSubjects from config (same aliases as Desktop watcher).
 */

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string|null|undefined} subject  WhatsApp group display name
 * @param {object} groupMap  { "site-memo": { matchNames: [...] }, ... }
 * @param {string} fallbackGroup
 * @returns {{ group: string, reason: string }}
 */
export function mapSubjectToGroup(subject, groupMap = {}, fallbackGroup = "unmapped") {
  const nSubject = normalize(subject);
  if (!nSubject) {
    return {
      group: fallbackGroup,
      reason: "empty group subject — using fallback",
    };
  }

  for (const [group, rules] of Object.entries(groupMap)) {
    const names = [
      ...(rules.matchNames || []),
      ...(rules.matchSubjects || []),
      group,
    ].map(normalize);

    for (const alias of names) {
      if (!alias) continue;
      if (nSubject === alias || nSubject.includes(alias) || alias.includes(nSubject)) {
        return {
          group,
          reason: `subject "${subject}" matched group "${group}" (alias "${alias}")`,
        };
      }
    }
  }

  return {
    group: fallbackGroup,
    reason: `subject "${subject}" unmatched — using fallback "${fallbackGroup}"`,
  };
}

export function listKnownGroups(groupMap = {}) {
  return Object.keys(groupMap);
}
