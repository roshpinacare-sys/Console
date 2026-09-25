// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · EVM — זהות סוכנים וחתימות בתקני Ethereum אמיתיים
//
// REAL: secp256k1, keccak256, EIP-191 (personal_sign), EIP-712 (typed data),
//       ecrecover — כולם פרימיטיבים תקניים של EVM, רצים מקומית.
// הערת יושר: בדמו המפתח הפרטי של הסוכן נשמר ב-DB (devKeyHex, DEVNET בלבד).
// בייצור — המפתח אצל הסוכן בסביבתו, הרשת מחזיקה רק כתובת + מפתח ציבורי,
// ומאמתת חתימות ב-ecrecover. בדיוק כמו /api/weave/verify.
// ─────────────────────────────────────────────────────────────────────

import {
  Wallet,
  SigningKey,
  verifyMessage,
  getBytes,
  TypedDataEncoder,
  zeroPadValue,
  toBeHex,
  recoverAddress,
} from "ethers";
import type { TypedDataField } from "ethers";

export interface AgentIdentity {
  address: string; // כתובת Ethereum (checksum)
  pubKeyHex: string; // מפתח ציבורי uncompressed 0x04… (65 bytes) — פומבי
  devKeyHex: string; // ⚠ DEVNET בלבד
}

/** מפתח ציבורי uncompressed (65 בתים, 0x04…) — פומבי, לאימות עצמאי */
export function uncompressedPublicKey(devKeyHex: string): string {
  return new SigningKey(devKeyHex).publicKey;
}

/** יצירת זהות סוכן חדשה — מפתח secp256k1 אקראי */
export function generateIdentity(): AgentIdentity {
  const w = Wallet.createRandom();
  return {
    address: w.address,
    pubKeyHex: uncompressedPublicKey(w.privateKey),
    devKeyHex: w.privateKey,
  };
}

/** שחזור זהות ממפתח קיים */
export function identityFromKey(devKeyHex: string): AgentIdentity {
  const w = new Wallet(devKeyHex);
  return {
    address: w.address,
    pubKeyHex: uncompressedPublicKey(w.privateKey),
    devKeyHex,
  };
}

/**
 * EIP-191 personal_sign על digest בן 32 בתים:
 * חותמים את keccak256("\x19Ethereum Signed Message:\n32" ++ digest).
 */
export async function signDigestEip191(devKeyHex: string, digest: string): Promise<string> {
  const w = new Wallet(devKeyHex);
  return await w.signMessage(getBytes(digest));
}

/** שחזור חותם (ecrecover) מחתימת EIP-191 על digest */
export function recoverFromDigestEip191(digest: string, sig: string): string {
  return verifyMessage(getBytes(digest), sig);
}

// ─── EIP-712 · Checkpoints ────────────────────────────────────────────

export const WEAVE_DOMAIN = {
  name: "SAOS-Weave",
  version: "1",
  chainId: 31337, // devnet מקומי — מתועד, לא מוסתר
} as const;

// הערה: טיפוס מפורש (ולא `as const`) — הספרייה דורשת מערכים ניתנים-לשינוי
// של TypedDataField[]; `as const` הופך אותם ל-readonly ונכשל בהשמה.
export const CHECKPOINT_TYPES: Record<string, TypedDataField[]> = {
  Checkpoint: [
    { name: "index", type: "uint256" },
    { name: "attFrom", type: "uint256" },
    { name: "attTo", type: "uint256" },
    { name: "root", type: "bytes32" },
    { name: "prevRoot", type: "bytes32" },
  ],
};

export interface CheckpointValue {
  index: number;
  attFrom: number;
  attTo: number;
  root: string;
  prevRoot: string;
}

/** EIP-712 digest של checkpoint */
export function checkpointDigest(cp: CheckpointValue): string {
  return TypedDataEncoder.hash(WEAVE_DOMAIN, CHECKPOINT_TYPES, {
    index: toBeHex(BigInt(cp.index)),
    attFrom: toBeHex(BigInt(cp.attFrom)),
    attTo: toBeHex(BigInt(cp.attTo)),
    root: cp.root,
    prevRoot: cp.prevRoot,
  });
}

/** חתימת EIP-712 של מפתח הרשת על checkpoint */
export async function signCheckpoint(devKeyHex: string, cp: CheckpointValue): Promise<string> {
  const w = new Wallet(devKeyHex);
  return await w.signTypedData(WEAVE_DOMAIN, CHECKPOINT_TYPES, {
    index: toBeHex(BigInt(cp.index)),
    attFrom: toBeHex(BigInt(cp.attFrom)),
    attTo: toBeHex(BigInt(cp.attTo)),
    root: cp.root,
    prevRoot: cp.prevRoot,
  });
}

/** שחזור חותם checkpoint — חתימת EIP-712 היא על digest יבש, בלי קידומת EIP-191 */
export function recoverCheckpointSigner(
  cp: CheckpointValue,
  sig: string
): string {
  const digest = checkpointDigest(cp);
  return recoverAddress(getBytes(digest), sig);
}

/** עזר: עיצוב bytes32 תקני */
export function toBytes32Hex(n: number): string {
  return zeroPadValue(toBeHex(BigInt(n)), 32);
}
