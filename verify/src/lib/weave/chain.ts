// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Chain — שרשרת ה-hash של ספר האימותים
//
// חוקי הקנון (דטרמיניסטיים לחלוטין, כך שכל צומת יכול לחשב מחדש):
//   GENESIS  = 0x0000...00 (64 אפסים) — prevHash של seq=1
//   entryHash = keccak256( JSON-קנוני של הרשומה )
//   ה-JSON נבנה תמיד באותו סדר מפתחות (literal קבוע בקוד הזה בלבד)
// ─────────────────────────────────────────────────────────────────────

import { keccak256, toUtf8Bytes } from "ethers";

export const GENESIS_HASH = "0x" + "0".repeat(64);

export function hashText(text: string): string {
  return keccak256(toUtf8Bytes(text));
}

/** הרשומה בצורתה הקנונית — סדר המפתחות קבוע ומחייב */
export interface AttestationRecord {
  seq: number;
  agentAddress: string;
  claimHash: string;
  claimType: string;
  evidenceHash: string;
  status: string;
  prevHash: string;
  createdAtIso: string;
}

/** בניית רשומה קנונית מהשדות הגולמיים */
export function canonicalAttestation(input: {
  seq: number;
  agentAddress: string;
  claim: string;
  claimType: string;
  evidenceHash: string;
  status: string;
  prevHash: string;
  createdAt: Date;
}): AttestationRecord {
  return {
    seq: input.seq,
    agentAddress: input.agentAddress,
    claimHash: hashText(input.claim),
    claimType: input.claimType,
    evidenceHash: input.evidenceHash,
    status: input.status,
    prevHash: input.prevHash,
    createdAtIso: input.createdAt.toISOString(),
  };
}

/** הרשומה כפי שהיא נשמרת ב-DB — ממופה חזרה לקנון לצורך אימות */
export function recordFromRow(row: {
  seq: number;
  claim: string;
  claimType: string;
  evidenceHash: string;
  status: string;
  prevHash: string;
  createdAt: Date | string;
}, agentAddress: string): AttestationRecord {
  const created =
    row.createdAt instanceof Date
      ? row.createdAt
      : new Date(row.createdAt);
  return canonicalAttestation({
    seq: row.seq,
    agentAddress,
    claim: row.claim,
    claimType: row.claimType,
    evidenceHash: row.evidenceHash,
    status: row.status,
    prevHash: row.prevHash,
    createdAt: created,
  });
}

/** hash הרשומה — הקישור בשרשרת */
export function hashEntry(rec: AttestationRecord): string {
  return keccak256(toUtf8Bytes(JSON.stringify(rec)));
}

export interface ChainLinkCheck {
  seq: number;
  ok: boolean;
  error?: string;
}

/**
 * אימות מלא של שלמות השרשרת — חישוב מחדש, לא סמיכות.
 * מקבל שורות ממוינות בעלייה לפי seq, כולל כתובת הסוכן של כל שורה.
 */
export function verifyChain(
  rows: Array<{
    seq: number;
    agentAddress: string;
    claim: string;
    claimType: string;
    evidenceHash: string;
    status: string;
    prevHash: string;
    entryHash: string;
    createdAt: Date | string;
  }>
): {
  valid: boolean;
  firstBreak: number | null;
  errors: string[];
  recomputedHead: string;
} {
  const errors: string[] = [];
  let firstBreak: number | null = null;
  let prev = GENESIS_HASH;
  let expectedSeq = 1;
  let recomputedHead = GENESIS_HASH;

  for (const row of rows) {
    if (row.seq !== expectedSeq) {
      const err = `seq ${row.seq}: פער רצף — ציפינו ל-${expectedSeq}`;
      errors.push(err);
      if (firstBreak === null) firstBreak = row.seq;
    }
    const rec = recordFromRow(row, row.agentAddress);
    const recomputed = hashEntry(rec);
    if (recomputed !== row.entryHash) {
      const err = `seq ${row.seq}: entryHash לא תואם — נמצא שיבוש (recomputed ${recomputed.slice(0, 10)}… ≠ stored ${row.entryHash.slice(0, 10)}…)`;
      errors.push(err);
      if (firstBreak === null) firstBreak = row.seq;
    }
    if (row.prevHash !== prev) {
      const err = `seq ${row.seq}: prevHash נותק — ציפינו ${prev.slice(0, 10)}… וקיבלנו ${row.prevHash.slice(0, 10)}…`;
      errors.push(err);
      if (firstBreak === null) firstBreak = row.seq;
    }
    prev = row.entryHash; // ה-head המקומי ממשיך מה-hash השמור — השבר "מתגלגל" קדימה
    recomputedHead = recomputed;
    expectedSeq = row.seq + 1;
  }

  return {
    valid: errors.length === 0,
    firstBreak,
    errors,
    recomputedHead,
  };
}
