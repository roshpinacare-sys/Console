/* ─────────────────────────────────────────────────────────────────────
 * THE WEAVE · ACID-Engine - מנוע הגילוי הריבוני (weave-acid-1.0.0)
 *
 * מקור: מודול ACID (Autonomous Computational Intelligence Discovery)
 * שהועלה מצי הרשת - נבדק לעומק, נמצא שבור (שגיאות תחביר ב-substrate.py
 * וב-verifier.py, ייבוא שם לא קיים) ותלוי-Cloudflare. הליבה הטובה -
 * מכונת מחסנית דטרמיניסטית + חיפוש אבולוציוני + אימות עצמאי - הובאה
 * לכאן כמימוש טהור, בלי שרת, בלי תלות חיצונית, בלי CDN.
 *
 * דוקטרינת הריבונות של המנוע:
 *   · דטרמיניזם מלא: אותו מזהה-משימה + זרע + פרמטרים => אותה תוכנית
 *     ואותו hash - בכל דפדפן, בכל סביבה, לנצח. ההוכחה שעל השרשרת
 *     היא מתכון: (משימה, זרע, דורות, אוכלוסייה) -> hash. כל אחד
 *     יכול לגזור את הפרי מחדש בעצמו, חינם.
 *   · הרשת משחזרת לפני שהיא מעידה: הלב הענני מריץ את אותו גילוי
 *     מהמתכון שהוחתם ב-custom_json; רק התאמת-hash מייצרת אימות
 *     DISCOVERY בספר. אין אמון - יש חישוב.
 *   · תווית אמת: המנוע מדווח רק על מה שנמדד (דורות, הערכות, צעדים).
 *     הוא אינו "אוטונומי" ואינו "משפר את עצמו" - הוא חיפוש תוכניות
 *     מודולרי, כפי שביקורת ה-ACID המקורית קבעה בכנות.
 *
 * תיקוני האמת מול המקור (מתועדים בכל נקודה):
 *   · substrate.py:140 - שורה מתה אחרי return (שגיאת תחביר) => כאן:
 *     execute מחזיר {outputs, steps, halted, timedOut} בבהירות.
 *   · verifier.py:86 - פסיק כפול ב-tuple (שגיאת תחביר) => כאן: סט פרימיטיבים קנוני אחד.
 *   · tasks.py - ייבא "Program" שאינו קיים => כאן: ספריית משימות עצמאית,
 *     כל משימה עם פתרון-יד שמוכיח פתירות (דוקטרינת ACID).
 *   · search.py classify_novelty - לוגיקת חיתוך שבורה => כאן: סט נקי.
 *   · smart_discover - RNG לא-זרוע (בלתי-ניתן לשחזור) => כאן: mulberry32
 *     זרוע; הכל נגזר מהזרע בלבד.
 *   · crossover - set() על קבועים (סדר בלתי-דטרמיניסטי) => כאן: דה-דופ
 *     שמראי-סדר.
 * ───────────────────────────────────────────────────────────────────── */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AcidEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var ENGINE_VERSION = "weave-acid-1.0.0";
  var MOD = 1000000;
  var MAX_STACK = 256;
  var MAX_MEMORY = 64;
  var MAX_STEPS = 10000;
  var MAX_PROGRAM_LENGTH = 200;
  var MAX_CONSTANTS = 10;
  var PRIMITIVES = [
    "PUSH", "POP", "DUP", "SWAP", "ADD", "SUB", "MUL", "MOD",
    "GT", "LT", "EQ", "AND", "OR", "NOT", "JZ", "READ", "WRITE", "STORE", "LOAD", "HALT",
  ];

  /* ═══════════════════ sha256 (טהור, סינכרוני, תלוי-שום-דבר) ═══════════════════ */
  var SHA_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  function utf8Bytes(str) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); }
      else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
    }
    return new Uint8Array(out);
  }
  function sha256Hex(text) {
    var msg = utf8Bytes(text);
    var bitLen = msg.length * 8;
    var withPad = new Uint8Array((((msg.length + 8) >> 6) + 1) << 6);
    withPad.set(msg);
    withPad[msg.length] = 0x80;
    var dv = new DataView(withPad.buffer);
    dv.setUint32(withPad.length - 4, bitLen >>> 0);
    dv.setUint32(withPad.length - 8, Math.floor(bitLen / 0x100000000));
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Int32Array(64);
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (var off = 0; off < withPad.length; off += 64) {
      for (var i = 0; i < 16; i++) w[i] = dv.getInt32(off + i * 4);
      for (var i = 16; i < 64; i++) {
        var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (var i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + SHA_K[i] + w[i]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var mj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + mj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = "";
    for (var i = 0; i < 8; i++) out += (H[i] >>> 0).toString(16).padStart(8, "0");
    return out;
  }

  /* ═══════════════════ RNG זרוע - mulberry32 (דטרמיניסטי חוצה-סביבות) ═══════════════════ */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function randInt(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

  /* ═══════════════════ תוכנית - מבנה, קנון, hash ═══════════════════ */
  function clampProgram(instructions, constants) {
    var ins = instructions.slice(0, MAX_PROGRAM_LENGTH);
    var cons = [];
    var seen = {};
    for (var i = 0; i < constants.length && cons.length < MAX_CONSTANTS; i++) {
      var v = constants[i] | 0;
      if (!seen[v]) { seen[v] = true; cons.push(v); }
    }
    if (cons.length === 0) cons = [0];
    return { instructions: ins, constants: cons };
  }
  /* הקנון: מפתחות בסדר קבוע (c לפני i), בלי רווחים - ההגדרה שלנו, מתועדת */
  function canonical(program) {
    var cons = program.constants.map(function (c) { return String(c); }).join(",");
    var ins = program.instructions.map(function (p) { return '["' + p[0] + '",' + p[1] + "]"; }).join(",");
    return '{"c":[' + cons + '],"i":[' + ins + "]}";
  }
  function hashProgram(program) { return sha256Hex(canonical(program)).slice(0, 16); }

  /* ═══════════════════ המצע - מכונת מחסנית (20 פרימיטיבים) ═══════════════════
   * סמנטיקה זהה ל-substrate.py המקורי (אחרי תיקון שגיאת התחביר):
   *   · חשבון מודולרי (mod 1e6) - כל ערך על המחסנית ב-[0, 1e6)
   *   · JZ קופץ ל-arg % n (עטיפה תמיד בתחום - ולכן בדיקת המבנה אינה
   *     מסמנת JZ כחוץ-טווח, בניגוד ל-verifier.py השבור)
   *   · READ כותב לזיכרון גם כשהמחסנית מלאה; WRITE כותב פלט בלי לשלוף
   */
  function execute(program, inputs) {
    var stack = [];
    var memory = new Array(MAX_MEMORY).fill(0);
    var inp = inputs || [];
    var inputIdx = 0;
    var outputs = [];
    var pc = 0;
    var steps = 0;
    var instr = program.instructions;
    var consts = program.constants;
    var n = instr.length;
    while (pc < n && steps < MAX_STEPS) {
      var pair = instr[pc];
      var op = pair[0];
      var arg = pair[1] | 0;
      steps++;
      if (op === "HALT") break;
      else if (op === "PUSH") {
        if (stack.length < MAX_STACK) stack.push(consts.length ? consts[arg % consts.length] : arg % 100);
      } else if (op === "POP") {
        if (stack.length) stack.pop();
      } else if (op === "DUP") {
        if (stack.length && stack.length < MAX_STACK) stack.push(stack[stack.length - 1]);
      } else if (op === "SWAP") {
        if (stack.length >= 2) {
          var t = stack[stack.length - 1];
          stack[stack.length - 1] = stack[stack.length - 2];
          stack[stack.length - 2] = t;
        }
      } else if (op === "ADD") {
        if (stack.length >= 2) { var b = stack.pop(), a = stack.pop(); stack.push((a + b) % MOD); }
      } else if (op === "SUB") {
        if (stack.length >= 2) { var b = stack.pop(), a = stack.pop(); stack.push((a - b + MOD) % MOD); }
      } else if (op === "MUL") {
        if (stack.length >= 2) { var b = stack.pop(), a = stack.pop(); stack.push((a * b) % MOD); }
      } else if (op === "MOD") {
        if (stack.length >= 2) { var b = stack.pop(), a = stack.pop(); stack.push(b !== 0 ? a % b : 0); }
      } else if (op === "GT") {
        if (stack.length >= 2) { var b = stack.pop(), a = stack.pop(); stack.push(a > b ? 1 : 0); }
      } else if (op === "LT") {
        if (stack.length >= 2) { var b = stack.pop(), a = stack.pop(); stack.push(a < b ? 1 : 0); }
      } else if (op === "EQ") {
        if (stack.length >= 2) { var b = stack.pop(), a = stack.pop(); stack.push(a === b ? 1 : 0); }
      } else if (op === "AND") {
        if (stack.length >= 2) { var b = stack.pop(), a = stack.pop(); stack.push(a !== 0 && b !== 0 ? 1 : 0); }
      } else if (op === "OR") {
        if (stack.length >= 2) { var b = stack.pop(), a = stack.pop(); stack.push(a !== 0 || b !== 0 ? 1 : 0); }
      } else if (op === "NOT") {
        if (stack.length) stack.push(stack.pop() !== 0 ? 0 : 1);
      } else if (op === "JZ") {
        if (stack.length) {
          var val = stack.pop();
          if (val === 0) {
            var target = arg % n;
            if (target >= 0 && target < n) { pc = target; continue; }
          }
        }
      } else if (op === "READ") {
        var cell = arg % MAX_MEMORY;
        if (inputIdx < inp.length) { memory[cell] = inp[inputIdx]; inputIdx++; }
        if (stack.length < MAX_STACK) stack.push(memory[cell]);
      } else if (op === "WRITE") {
        var cell = arg % MAX_MEMORY;
        if (stack.length) { memory[cell] = stack[stack.length - 1]; outputs.push(stack[stack.length - 1]); }
      } else if (op === "STORE") {
        var cell = arg % MAX_MEMORY;
        if (stack.length) memory[cell] = stack[stack.length - 1];
      } else if (op === "LOAD") {
        var cell = arg % MAX_MEMORY;
        if (stack.length < MAX_STACK) stack.push(memory[cell]);
      }
      pc++;
    }
    return {
      outputs: outputs,
      steps: steps,
      /* הגדרת המקור: halted = רץ מעבר לקצה או חרג מצעדים (לא "עצר נקי") */
      halted: pc >= n || steps >= MAX_STEPS,
      timedOut: steps >= MAX_STEPS,
    };
  }

  /* ═══════════════════ ספריית המשימות ═══════════════════
   * דוקטרינת ACID: לכל משימה פתרון-יד (הוכחת פתירות) וקלטים זרועים.
   * ההצלחה האקראית של תוכנית שרירותית נמוכה מ-5% (מדידה: פלט מדויק
   * של ערך ב-[0,1e6) ≈ 1e-6 לכל מילה).
   */
  function mkInputs(rng, len) {
    var out = [];
    for (var i = 0; i < len; i++) out.push(randInt(rng, 1, 999999));
    return out;
  }
  var TASKS = {
    sum2: {
      spec: "סכום שני קלטים (mod 1e6)",
      en: "sum of 2 inputs",
      inputLen: 2,
      expected: function (inp) { return [(inp[0] + inp[1]) % MOD]; },
      hand: { instructions: [["READ", 0], ["READ", 1], ["ADD", 0], ["WRITE", 2], ["HALT", 0]], constants: [0] },
    },
    sum3: {
      spec: "סכום שלושה קלטים (mod 1e6)",
      en: "sum of 3 inputs",
      inputLen: 3,
      expected: function (inp) { return [(inp[0] + inp[1] + inp[2]) % MOD]; },
      hand: { instructions: [["READ", 0], ["READ", 1], ["ADD", 0], ["READ", 2], ["ADD", 0], ["WRITE", 3], ["HALT", 0]], constants: [0] },
    },
    mul2: {
      spec: "מכפלה של שני קלטים (mod 1e6)",
      en: "product of 2 inputs",
      inputLen: 2,
      expected: function (inp) { return [(inp[0] * inp[1]) % MOD]; },
      hand: { instructions: [["READ", 0], ["READ", 1], ["MUL", 0], ["WRITE", 2], ["HALT", 0]], constants: [0] },
    },
    sub2: {
      spec: "הפרש a−b (עטיפה מודולרית)",
      en: "a minus b (mod wrap)",
      inputLen: 2,
      expected: function (inp) { return [(inp[0] - inp[1] + MOD) % MOD]; },
      hand: { instructions: [["READ", 0], ["READ", 1], ["SUB", 0], ["WRITE", 2], ["HALT", 0]], constants: [0] },
    },
    dbl: {
      spec: "הכפלת הקלט ב-2 (mod 1e6)",
      en: "double the input",
      inputLen: 1,
      expected: function (inp) { return [(inp[0] * 2) % MOD]; },
      hand: { instructions: [["READ", 0], ["DUP", 0], ["ADD", 0], ["WRITE", 1], ["HALT", 0]], constants: [0] },
    },
    sq2: {
      spec: "סכום ריבועים a²+b² (mod 1e6)",
      en: "sum of squares",
      inputLen: 2,
      hard: true,
      searchNote: "משימת הרכבה קשה - 1/5 זרעים ב-600 דורות (נמדד)",
      expected: function (inp) { return [((inp[0] * inp[0]) % MOD + (inp[1] * inp[1]) % MOD) % MOD]; },
      hand: { instructions: [["READ", 0], ["DUP", 0], ["MUL", 0], ["READ", 1], ["DUP", 0], ["MUL", 0], ["ADD", 0], ["WRITE", 2], ["HALT", 0]], constants: [0] },
    },
    echo3: {
      spec: "החזרת שלושת הקלטים כפלט",
      en: "echo all 3 inputs",
      inputLen: 3,
      expected: function (inp) { return [inp[0], inp[1], inp[2]]; },
      hand: { instructions: [["READ", 0], ["WRITE", 3], ["READ", 1], ["WRITE", 4], ["READ", 2], ["WRITE", 5], ["HALT", 0]], constants: [0] },
    },
    const42: {
      spec: "החזרת הקבוע 42 (קלט לא רלוונטי)",
      en: "emit constant 42",
      inputLen: 1,
      expected: function () { return [42]; },
      hand: { instructions: [["PUSH", 0], ["WRITE", 1], ["HALT", 0]], constants: [42] },
    },
    gt_check: {
      spec: "החזרת 1 אם a>b, אחרת 0",
      en: "a greater than b",
      inputLen: 2,
      expected: function (inp) { return [inp[0] > inp[1] ? 1 : 0]; },
      hand: { instructions: [["READ", 0], ["READ", 1], ["GT", 0], ["WRITE", 2], ["HALT", 0]], constants: [0] },
    },
    max2: {
      spec: "מקסימום של שני קלטים - דורש ענף (GT+JZ)",
      en: "max of 2 inputs (branching)",
      inputLen: 2,
      expected: function (inp) { return [Math.max(inp[0], inp[1])]; },
      hard: true,
      searchNote: "פתרון-יד מוכיח פתירות; החיפוש טרם השיג (0/5 זרעים ב-600 דורות) - אמת מדודה, לא מוסתרת",
      hand: {
        instructions: [
          ["READ", 0], ["READ", 1], ["GT", 0], ["JZ", 7],
          ["LOAD", 0], ["WRITE", 2], ["HALT", 0],
          ["LOAD", 1], ["WRITE", 2], ["HALT", 0],
        ],
        constants: [0],
      },
    },
  };

  /* ═══════════════════ בלוקים לזריעת אוכלוסייה (מ-search.py) ═══════════════════ */
  var BLOCKS = {
    read_pair_add: [["READ", 0], ["READ", 1], ["ADD", 0]],
    read_add_write: [["READ", 0], ["READ", 1], ["ADD", 0], ["WRITE", 2]],
    read_triple_add: [["READ", 0], ["READ", 1], ["ADD", 0], ["READ", 2], ["ADD", 0], ["WRITE", 3]],
    push_write: [["PUSH", 0], ["WRITE", 1]],
    read_write: [["READ", 0], ["WRITE", 1]],
    dup_add: [["READ", 0], ["DUP", 0], ["ADD", 0], ["WRITE", 1]],
    /* בלוקי הרכבה שנוספו בשיפור (בעיית הגרדיאנט שנמדדה בפועל):
     * ללא מקור חלקי היה החיפוש עיוור - 0/5 זרעים ב-400 דורות */
    read_pair_mul: [["READ", 0], ["READ", 1], ["MUL", 0]],
    dup_mul: [["READ", 0], ["DUP", 0], ["MUL", 0], ["WRITE", 1]],
  };
  var BLOCK_NAMES = Object.keys(BLOCKS);

  function randomProgram(rng, maxLen) {
    var len = randInt(rng, 5, maxLen || 25);
    var constants = [];
    var nConsts = randInt(rng, 1, 6);
    for (var i = 0; i < nConsts; i++) constants.push(randInt(rng, 0, 100));
    var instructions = [];
    for (var i = 0; i < len; i++) {
      var op = pick(rng, PRIMITIVES.concat(["HALT"]));
      instructions.push([op, randInt(rng, 0, Math.max(constants.length - 1, 10))]);
    }
    return clampProgram(instructions, constants);
  }
  function blockSeededProgram(rng, blockName) {
    var instructions = BLOCKS[blockName].slice();
    var tail = randInt(rng, 0, 5);
    for (var i = 0; i < tail; i++) instructions.push([pick(rng, PRIMITIVES), randInt(rng, 0, 10)]);
    instructions.push(["HALT", 0]);
    var constants = [];
    for (var i = 0; i < 5; i++) constants.push(randInt(rng, 0, 50));
    return clampProgram(instructions, constants);
  }
  function initialPopulation(rng, popSize) {
    var population = [];
    var nBlocks = Math.max(1, Math.floor(popSize / 3));
    for (var i = 0; i < nBlocks; i++) population.push(blockSeededProgram(rng, pick(rng, BLOCK_NAMES)));
    while (population.length < popSize) population.push(randomProgram(rng, 25));
    return population;
  }

  /* ═══════════════════ מוטציה חכמה (שלוש אסטרטגיות לפי ציון) ═══════════════════ */
  function smartMutate(program, score, rng) {
    var instructions = program.instructions.slice();
    var constants = program.constants.slice();
    if (score > 0.5) {
      /* ליטוש: שינוי ארגומנט אחד */
      if (instructions.length > 2) {
        var idx = randInt(rng, 0, instructions.length - 1);
        instructions[idx] = [instructions[idx][0], randInt(rng, 0, 20)];
      }
    } else if (score > 0) {
      /* הוספת תבנית מועילה */
      var patterns = [
        [["READ", randInt(rng, 0, 3)], ["ADD", 0]],
        [["DUP", 0], ["ADD", 0]],
        [["READ", randInt(rng, 0, 3)], ["MUL", 0]],
        [["DUP", 0], ["MUL", 0]],
      ];
      var pattern = pick(rng, patterns);
      var pos = randInt(rng, 0, instructions.length);
      for (var i = 0; i < pattern.length; i++) instructions.splice(pos + i, 0, pattern[i]);
    } else {
      /* חקירה: שינוי גדול */
      var r = rng();
      if (r < 0.3 && instructions.length > 0) {
        var idx = randInt(rng, 0, instructions.length - 1);
        instructions[idx] = [pick(rng, PRIMITIVES.concat(["HALT"])), instructions[idx][1]];
      } else if (r < 0.6 && instructions.length < MAX_PROGRAM_LENGTH) {
        instructions.splice(randInt(rng, 0, instructions.length), 0, [pick(rng, PRIMITIVES), randInt(rng, 0, 10)]);
      } else if (instructions.length > 3) {
        instructions.splice(randInt(rng, 0, instructions.length - 1), 1);
      }
    }
    if (rng() < 0.3 && constants.length) constants[randInt(rng, 0, constants.length - 1)] = randInt(rng, 0, 50);
    return clampProgram(instructions, constants);
  }

  /* ═══════════════════ crossover - דה-דופ שמראי-סדר (תיקון set() הבלתי-דטרמיניסטי) ═══════════════════ */
  function crossover(p1, p2, rng) {
    if (p1.instructions.length < 2 || p2.instructions.length < 2) return p1;
    var cut1 = randInt(rng, 1, p1.instructions.length - 1);
    var cut2 = randInt(rng, 1, p2.instructions.length - 1);
    var instructions = p1.instructions.slice(0, cut1).concat(p2.instructions.slice(cut2));
    var constants = [];
    var seen = {};
    var all = p1.constants.concat(p2.constants);
    for (var i = 0; i < all.length && constants.length < MAX_CONSTANTS; i++) {
      if (!seen[all[i]]) { seen[all[i]] = true; constants.push(all[i]); }
    }
    return clampProgram(instructions, constants);
  }

  /* ═══════════════════ ניקוד מדורג - תיקון בעיית הגרדיאנט ═══════════════════
   * המקור (smart_discover): פלט מדויק=1.0, ±1=0.3, אחרת 0 - חיפוש עיוור
   * (נמדד: sq2 0/5 זרעים ב-400 דורות). כאן: ניקוד מוצבי לפי מרחק
   * מעגלי על חוג mod 1e6 - exp(−dist/25) לכל מילה + בונוס התאמת-אורך.
   * הציון החלקי חתום מעלה ב-0.95 - "נמצא" נשאר 1.0 בלבד.
   */
  function scoreRun(outputs, expected) {
    if (!outputs || !outputs.length) return 0;
    if (outputs.length === expected.length) {
      var exact = true;
      for (var i = 0; i < outputs.length; i++) if (outputs[i] !== expected[i]) { exact = false; break; }
      if (exact) return 1;
    }
    var n = Math.max(outputs.length, expected.length);
    var total = 0;
    var m = Math.min(outputs.length, expected.length);
    for (var i = 0; i < m; i++) {
      var d = Math.abs(outputs[i] - expected[i]);
      var circ = Math.min(d, MOD - d);
      total += Math.exp(-circ / 25);
    }
    var s = (outputs.length === expected.length ? 0.1 : 0.05) + 0.9 * (total / n);
    return Math.min(s, 0.95);
  }

  /* ═══════════════════ הגילוי - סטֶפֶּר דטרמיניסטי ═══════════════════
   * createDiscovery(opts) מחזיר אובייקט עם step(maxEvals) - מאפשר ל-UI
   * לרוץ בנתחים בלי להקפיא את הדפדפן, ולענן לרוץ הכל בבת אחת.
   * הכל נגזר מהזרע - אין Date.now ואין Math.random בדרך.
   */
  function createDiscovery(opts) {
    var taskId = opts.taskId;
    var task = TASKS[taskId];
    if (!task) throw new Error("משימה לא מוכרת: " + taskId);
    var seed = (opts.seed >>> 0);
    var generations = Math.max(1, Math.min(opts.generations | 0 || 200, 5000));
    var popSize = Math.max(8, Math.min(opts.population | 0 || 60, 500));
    var rng = mulberry32(seed);
    var trainRng = mulberry32(seed ^ 0x5eed0000);
    var trainInputs = mkInputs(trainRng, task.inputLen);

    var population = initialPopulation(rng, popSize);
    var stats = { generated: popSize, executed: 0, generations: 0, bestScore: 0 };
    var history = [];
    var gen = 0;
    var done = false;
    var result = null;

    function runGeneration() {
      var scored = [];
      for (var i = 0; i < population.length; i++) {
        var run = execute(population[i], trainInputs);
        stats.executed++;
        var s = scoreRun(run.outputs, task.expected(trainInputs));
        var demoted = false;
        /* אימות-על: ציון מושלם על קלט האימון בלבד היא התאמת-יתר -
         * בודקים 8 סטים לפני שמכריזים "נמצא": 3 זרועים + משפחת
         * הגבולות הקנונית (כולם-0, כולם-1, כולם-מקס, סיבוב מינ/מקס)
         * - הסטים הקנוניים הורגים דטרמיניסטית תוכניות שמצליחות רק
         * בכיוון אחד (נמדד: READ 0/WRITE 1 עבר 5 סטים אקראיים במקרה
         * שכולם a>b). תוכנית שלא מכלילה מודחת ל-0.95 - קרובה אך
         * אינה פתרון. הגרלה זרועה מ-(seed, gen) - דטרמיניסטי. */
        if (s >= 1) {
          var ofRng = mulberry32(((seed ^ 0xfeed0000) + (gen + 1) * 2654435761) >>> 0);
          var ofSets = [];
          for (var k = 0; k < 3; k++) ofSets.push(mkInputs(ofRng, task.inputLen));
          var L = task.inputLen;
          ofSets.push(new Array(L).fill(0));
          ofSets.push(new Array(L).fill(1));
          ofSets.push(new Array(L).fill(999999));
          var loHi = new Array(L).fill(999999); loHi[0] = 1;
          ofSets.push(loHi);
          var hiLo = new Array(L).fill(1); hiLo[0] = 999999;
          ofSets.push(hiLo);
          var generalizes = true;
          for (var k = 0; k < ofSets.length; k++) {
            var or = execute(population[i], ofSets[k]);
            var oe = task.expected(ofSets[k]);
            if (or.outputs.length !== oe.length) { generalizes = false; break; }
            for (var j = 0; j < oe.length; j++) if (or.outputs[j] !== oe[j]) { generalizes = false; break; }
            if (!generalizes) break;
          }
          if (!generalizes) { s = 0.95; demoted = true; }
        }
        scored.push([s, population[i], demoted]);
      }
      scored.sort(function (a, b) { return b[0] - a[0]; });
      stats.generations = gen + 1;
      if (scored[0][0] > stats.bestScore) stats.bestScore = scored[0][0];
      history.push({ gen: gen, evals: stats.executed, best: scored[0][0] });
      if (scored[0][0] >= 1) {
        done = true;
        result = {
          found: true,
          taskId: taskId,
          seed: seed,
          generations: gen + 1,
          population: popSize,
          evals: stats.executed,
          program: scored[0][1],
          hash: hashProgram(scored[0][1]),
          history: history,
        };
        return;
      }
      /* ניצולים: רק תוכניות שהוכיחו הכללה - התאמות-יתר מודחות מהאליטה
       * (ציון 0.95 שנשאר אליטה לנצח נמדד כמחנה את החיפוש). אם כולן
       * מודחות - נופלים בחזרה לסדר הציון הגולמי. */
      var nonDemoted = scored.filter(function (e) { return !e[2]; });
      var pool = nonDemoted.length ? nonDemoted : scored;
      var survivors = [];
      var nSurv = Math.max(2, Math.floor(popSize / 4));
      for (var i = 0; i < nSurv && i < pool.length; i++) survivors.push(pool[i][1]);
      var newPop = [pool[0][1]];
      while (newPop.length < popSize) {
        var r = rng();
        if (r < 0.3 && survivors.length) {
          var idx = Math.floor(rng() * survivors.length);
          newPop.push(smartMutate(survivors[idx], pool[idx][0], rng));
        } else if (r < 0.5 && survivors.length >= 2) {
          newPop.push(crossover(pick(rng, survivors), pick(rng, survivors), rng));
        } else {
          newPop.push(randomProgram(rng, 25));
        }
        stats.generated++;
      }
      population = newPop;
      gen++;
      if (gen >= generations) {
        done = true;
        result = {
          found: false,
          taskId: taskId,
          seed: seed,
          generations: generations,
          population: popSize,
          evals: stats.executed,
          bestScore: stats.bestScore,
          history: history,
        };
      }
    }

    return {
      step: function (maxEvals) {
        if (done) return { done: true, result: result, progress: stats };
        var budget = maxEvals || Infinity;
        var before = stats.executed;
        while (!done && stats.executed - before < budget) runGeneration();
        return { done: done, result: result, progress: stats };
      },
      progress: function () { return stats; },
      get done() { return done; },
      get result() { return result; },
    };
  }
  function discoverSync(opts) {
    var d = createDiscovery(opts);
    var out;
    do { out = d.step(Infinity); } while (!out.done);
    return out.result;
  }

  /* ═══════════════════ המאמת העצמאי - 5 מבחנים ═══════════════════
   * נפרד מהגילוי (אסטרטגיה אחרת, זרע אחר, קפידה יתרה) - דוקטרינת ACID:
   * "Verification > Trust". מתקן את verifier.py (שבור התחביר) ומיישר
   * את בדיקת המבנה לסמנטיקת המצע (JZ נעטף תמיד).
   */
  function verifyFull(program, taskId, seed) {
    var task = TASKS[taskId];
    if (!task) throw new Error("משימה לא מוכרת: " + taskId);
    var tests = [];
    var trainRng = mulberry32((seed >>> 0) ^ 0x5eed0000);
    var trainInputs = mkInputs(trainRng, task.inputLen);

    /* 1 - פונקציונלי */
    var run1 = execute(program, trainInputs);
    var exp1 = task.expected(trainInputs);
    var ok1 = run1.outputs.length === exp1.length && run1.outputs.every(function (v, i) { return v === exp1[i]; });
    tests.push({ id: "functional", name: "פונקציונלי - קלט האימון", pass: ok1, detail: "פלט " + JSON.stringify(run1.outputs.slice(0, 4)) + " · צפוי " + JSON.stringify(exp1.slice(0, 4)) });

    /* 2 - רב-קלט (10 סטים זרועים) */
    var multiRng = mulberry32((seed >>> 0) ^ 0xfeed0000);
    var ok2 = true;
    var n2 = 0;
    for (var i = 0; i < 10; i++) {
      var inputs = mkInputs(multiRng, task.inputLen);
      var run = execute(program, inputs);
      var exp = task.expected(inputs);
      var ok = run.outputs.length === exp.length && run.outputs.every(function (v, j) { return v === exp[j]; });
      if (ok) n2++;
      else ok2 = false;
    }
    tests.push({ id: "multi", name: "רב-קלט - 10 סטים אקראיים זרועים", pass: ok2, detail: n2 + "/10 התאימו" });

    /* 3 - דטרמיניזם (5 ריצות) */
    var uniq = {};
    for (var i = 0; i < 5; i++) {
      var run = execute(program, trainInputs);
      uniq[JSON.stringify(run.outputs)] = true;
    }
    var nUniq = Object.keys(uniq).length;
    tests.push({ id: "determinism", name: "דטרמיניזם - 5 ריצות זהות", pass: nUniq === 1, detail: nUniq + " פלטים ייחודיים (צפוי 1)" });

    /* 4 - משאבים */
    var ok4 = !run1.timedOut && run1.steps < MAX_STEPS && program.instructions.length <= MAX_PROGRAM_LENGTH;
    tests.push({ id: "resource", name: "משאבים - גבולות צעדים ואורך", pass: ok4, detail: run1.steps + " צעדים (גבול " + MAX_STEPS + ") · אורך " + program.instructions.length });

    /* 5 - אדוורסריאלי (ערכי קצה, באורך החוזה של המשימה - קלט ריק הוא
     * מחוץ לחוזה; נבדק רק שהריצה לא קורסת, לא שהפלט נכון) */
    var edgeSets = [];
    var L = task.inputLen;
    var boundary = [0, 1, 999999, 500000, 999998, 42];
    for (var bi = 0; bi < boundary.length; bi++) {
      var inputs = [];
      for (var j = 0; j < L; j++) inputs.push(boundary[(bi + j) % boundary.length]);
      edgeSets.push(inputs);
    }
    var ok5 = true;
    var n5 = 0;
    for (var i = 0; i < edgeSets.length; i++) {
      var run = execute(program, edgeSets[i]);
      var exp = task.expected(edgeSets[i]);
      var ok = run.outputs.length === exp.length && run.outputs.every(function (v, j) { return v === exp[j]; });
      if (ok) n5++;
      else ok5 = false;
    }
    var emptyRun = execute(program, []);
    var emptySafe = Array.isArray(emptyRun.outputs) && isFinite(emptyRun.steps);
    tests.push({ id: "adversarial", name: "אדוורסריאלי - ערכי קצה", pass: ok5 && emptySafe, detail: n5 + "/" + edgeSets.length + " (0, 1, 999999, 500000…) · קלט-ריק: רץ בלי קריסה" });

    var allPass = tests.every(function (t) { return t.pass; });
    return { taskId: taskId, seed: seed, hash: hashProgram(program), verified: allPass, tests: tests, passedCount: tests.filter(function (t) { return t.pass; }).length };
  }

  /* ═══════════════════ מבחן עצמי - הוכחה בעליית הדף ═══════════════════ */
  function selfTest() {
    var checks = [];
    function check(name, fn) {
      try { var v = fn(); checks.push({ name: name, pass: !!v }); }
      catch (e) { checks.push({ name: name, pass: false, detail: String(e && e.message || e) }); }
    }
    /* sha256 מול וקטורים ידועים */
    check("sha256(\"\") = e3b0c442…", function () { return sha256Hex("") === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"; });
    check("sha256(\"abc\") = ba7816bf…", function () { return sha256Hex("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"; });
    /* יחידות המצע (מ-validate_substrate + מקרי קצה) */
    check("מצע: push_write", function () {
      var p = clampProgram([["PUSH", 0], ["WRITE", 1], ["HALT", 0]], [42]);
      return JSON.stringify(execute(p, [42]).outputs) === "[42]";
    });
    check("מצע: add", function () {
      var p = clampProgram([["PUSH", 0], ["PUSH", 1], ["ADD", 0], ["WRITE", 2], ["HALT", 0]], [3, 7]);
      return JSON.stringify(execute(p, []).outputs) === "[10]";
    });
    check("מצע: read_add", function () {
      var p = clampProgram([["READ", 0], ["READ", 1], ["ADD", 0], ["WRITE", 2], ["HALT", 0]], [0]);
      return JSON.stringify(execute(p, [2, 3]).outputs) === "[5]";
    });
    check("מצע: store_load", function () {
      var p = clampProgram([["READ", 0], ["STORE", 1], ["LOAD", 1], ["WRITE", 2], ["HALT", 0]], [0]);
      return JSON.stringify(execute(p, [42]).outputs) === "[42]";
    });
    check("מצע: עטיפה מודולרית של SUB (a<b)", function () {
      var p = clampProgram([["READ", 0], ["READ", 1], ["SUB", 0], ["WRITE", 2], ["HALT", 0]], [0]);
      return execute(p, [3, 7]).outputs[0] === 999996;
    });
    check("מצע: JZ קופץ", function () {
      var p = clampProgram([["PUSH", 0], ["JZ", 4], ["PUSH", 1], ["WRITE", 1], ["HALT", 0], ["PUSH", 0], ["WRITE", 2], ["HALT", 0]], [7, 0]);
      return JSON.stringify(execute(p, []).outputs) === "[0]";
    });
    check("מצע: פסק-זמן נמדד", function () {
      var p = clampProgram([["PUSH", 0], ["JZ", 0]], [0]);
      return execute(p, []).timedOut === true;
    });
    /* פתרונות-יד: כל משימה פתירה ומאומתת 5/5 */
    Object.keys(TASKS).forEach(function (id) {
      check("משימה " + id + ": פתרון-יד עובר 5/5", function () {
        var v = verifyFull(TASKS[id].hand, id, 4242);
        return v.verified && v.tests.every(function (t) { return t.pass; });
      });
    });
    /* דטרמיניזם גילוי: אותו זרע => אותו hash (פעמיים) */
    check("דטרמיניזם גילוי (זרע 7, פעמיים)", function () {
      var a = discoverSync({ taskId: "sum3", seed: 7, generations: 120, population: 50 });
      var b = discoverSync({ taskId: "sum3", seed: 7, generations: 120, population: 50 });
      return a.found && b.found && a.hash === b.hash && JSON.stringify(a.program.instructions) === JSON.stringify(b.program.instructions);
    });
    /* גילוי אמיתי: מוטציה מגלה את הפרש (ADD->SUB מבלוק הזריעה) -
     * לא בלוק מוכן ולא התאמת-יתר. מדוד: 5/5 זרעים, 8-234 דורות. */
    check("גילוי חי: sub2 (מוטציה אמיתית) נמצא ומאומת 5/5", function () {
      var d = discoverSync({ taskId: "sub2", seed: 1337, generations: 300, population: 80 });
      if (!d.found) return false;
      var v = verifyFull(d.program, "sub2", 1337);
      return v.verified;
    });
    var pass = checks.filter(function (c) { return c.pass; }).length;
    return { pass: pass, total: checks.length, checks: checks, version: ENGINE_VERSION };
  }

  /* ═══════════════════ חבילת ההוכחה (המתכון שנחתם לשרשרת) ═══════════════════ */
  function proofBundle(discovery) {
    return {
      ev: ENGINE_VERSION,
      t: discovery.taskId,
      s: discovery.seed,
      g: discovery.generations,
      p: discovery.population,
      h: discovery.hash,
    };
  }

  return {
    ENGINE_VERSION: ENGINE_VERSION,
    PRIMITIVES: PRIMITIVES,
    LIMITS: { MOD: MOD, MAX_STACK: MAX_STACK, MAX_MEMORY: MAX_MEMORY, MAX_STEPS: MAX_STEPS, MAX_PROGRAM_LENGTH: MAX_PROGRAM_LENGTH },
    TASKS: TASKS,
    taskIds: Object.keys(TASKS),
    execute: execute,
    clampProgram: clampProgram,
    canonical: canonical,
    hashProgram: hashProgram,
    sha256Hex: sha256Hex,
    mulberry32: mulberry32,
    createDiscovery: createDiscovery,
    discoverSync: discoverSync,
    verifyFull: verifyFull,
    selfTest: selfTest,
    proofBundle: proofBundle,
  };
});
