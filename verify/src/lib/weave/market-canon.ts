// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Market Canon — הקנון הטהור של שרשרת אירועי השוק
//
// מודול חסר-תלות ב-DB: ethers בלבד. זה מאפשר לכל צד שלישי להריץ
// replay מלא של ספר השוק מה-ledger המיוצא (scripts/weave-verify-book.ts)
// בלי Prisma, בלי סודות, בלי לסמוך עלינו — חוק 13: אמת = חישוב-מחדש.
//
// ⚠ חוק נאמנות-קוד: הפונקציות כאן הן הקנון היחיד. market.ts מייבא
// מכאן ומייצא מחדש — אותו קוד בדיוק חותם בכתיבה ומאמת ב-replay.
// ─────────────────────────────────────────────────────────────────────

import { GENESIS_HASH, hashText } from "./chain";

export const MARKET_GENESIS = GENESIS_HASH;

/** הרשומה בצורתה הקנונית — סדר מפתחות קבוע */
export interface MarketEventRecord {
  seq: number;
  kind: string;
  payloadHash: string;
  prevHash: string;
  createdAtIso: string;
}

export function canonicalMarketEvent(input: {
  seq: number;
  kind: string;
  payloadHash: string;
  prevHash: string;
  createdAt: Date;
}): MarketEventRecord {
  return {
    seq: input.seq,
    kind: input.kind,
    payloadHash: input.payloadHash,
    prevHash: input.prevHash,
    createdAtIso: input.createdAt.toISOString(),
  };
}

/** ה-JSON הקנוני של הרשומה — literal קבוע, כמו בספר האימותים */
export function canonicalMarketJson(rec: MarketEventRecord): string {
  return (
    `{"seq":${rec.seq},"kind":"${rec.kind}","payloadHash":"${rec.payloadHash}",` +
    `"prevHash":"${rec.prevHash}","createdAtIso":"${rec.createdAtIso}"}`
  );
}

export function marketEntryHash(rec: MarketEventRecord): string {
  return hashText(canonicalMarketJson(rec));
}
