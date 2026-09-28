#!/usr/bin/env node
// Z-15 · anchor-selftest.mjs — offline vectors for the anchor pair.
// No network, no keys, no ethers: pure logic only. 16 vectors, exit 0 = PASS.
import { verdictOf, bookShapeOk, artifactLine, SELECTOR } from "./anchor-verify.mjs";

const BOOK = {
  ok: true, version: 2, day: "2026-09-28", dayNumber: 20659,
  sovereignEoa: "0x01Bd2879Cd9990Cb4B25cD6DE47f378Dc5D18B37",
  dayRoot: "0x93d6b2ab26998813219d460b9d6f7b4d63bb80ad5d29623fcfac76c4ebc10d69",
  artifacts: [{ name: "mission-kpi", rail: "KPI", ref: "fleet/KPI.json@2026-09-28", value: "$4.256/day", digest: "0xe4a0e80f56f9534b09f4f682b2525b20cc29285a9d258a65a276a650e31fc356" }],
  chains: {
    OPTIMISM: { reachable: true, relay: "0x56c9D54ea866e25916757903E51392BBEdeE2ECe", chainId: 10, readyToSign: { to: "0x56c9D54ea866e25916757903E51392BBEdeE2ECe", data: "0x8be975cf93d6b2ab26998813219d460b9d6f7b4d63bb80ad5d29623fcfac76c4ebc10d69", gasLimit: "0x6d0c", value: "0x0", chainId: 10 } },
  },
};
const RC_OK = {
  ok: true, tool: "anchor-execute.mjs", chain: "OPTIMISM", chainId: 10,
  relay: "0x56c9D54ea866e25916757903E51392BBEdeE2ECe", dayRoot: BOOK.dayRoot, day: BOOK.day,
  eoa: "0x01Bd2879Cd9990Cb4B25cD6DE47f378Dc5D18B37",
  txHash: "0x" + "ab".repeat(32), block: 123456789, gasUsed: "27916", txStatus: 1,
  calldataPrefix: SELECTOR, readBack: { node: "mainnet.optimism.io", match: true },
};
const RC = (over = {}) => JSON.parse(JSON.stringify({ ...RC_OK, ...over }));

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { const r = fn(); if (r === true) { pass++; } else { fail++; console.log(`FAIL ${name}: got`, r); } }
  catch (e) { fail++; console.log(`FAIL ${name}: threw ${e.message}`); }
};
const v = (rc, chain = "OPTIMISM") => verdictOf(rc, BOOK, chain).ok;

// 1-4: the good paths
t("good receipt verifies", () => v(RC()));
t("book shape ok", () => bookShapeOk(BOOK) === true);
t("artifact line format", () => artifactLine(BOOK.artifacts[0]) === "KPI|fleet/KPI.json@2026-09-28|$4.256/day");
t("selector constant pinned", () => SELECTOR === "0x8be975cf");
// 5-9: tamper vectors — every field of the receipt vs the book
t("tampered dayRoot rejected", () => v(RC({ dayRoot: "0x" + "00".repeat(32) })) === false);
t("tampered relay rejected", () => v(RC({ relay: "0x" + "11".repeat(20) })) === false);
t("tampered eoa rejected", () => v(RC({ eoa: "0x" + "22".repeat(20) })) === false);
t("failed tx status rejected", () => v(RC({ txStatus: 0 })) === false);
t("read-back mismatch rejected", () => v(RC({ readBack: { node: "x", match: false } })) === false);
// 10-13: book-side rigidity
t("wrong chain lookup rejected", () => v(RC(), "BASE") === false);
t("missing chain rejected", () => v(RC(), "ARBITRUM") === false);
t("malformed book rejected", () => bookShapeOk({ ok: true }) === false);
t("missing receipt rejected", () => verdictOf(null, BOOK, "OPTIMISM").ok === false);
// 14-16: cross-book consistency (receipt from another day/chain must not verify)
t("receipt of another dayRoot rejected", () => v(RC({ dayRoot: "0x" + "77".repeat(32) })) === false);
t("chainId cross rejected", () => v(RC({ chainId: 8453 })) === false);
t("case-insensitive address match", () => v(RC({ relay: RC().relay.toUpperCase().replace("0X", "0x"), eoa: RC().eoa.toUpperCase().replace("0X", "0x") })) === true);

console.log(`anchor-selftest: ${pass}/${pass + fail} vectors PASS`);
process.exit(fail === 0 ? 0 : 1);
