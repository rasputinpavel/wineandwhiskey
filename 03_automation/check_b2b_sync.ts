// Guard: several packages keep a hand-maintained MIRROR of the canonical B2B
// classifier (because Railway builds each service from its own directory,
// cross-package imports are impossible at runtime). This script fails if any
// mirror has drifted from the canonical list in 03_automation/lib/b2b.ts.
//
// Run from repo root:  npm run check:b2b
// Wire into CI / pre-push to prevent silent divergence.

import * as canonical from "./lib/b2b";
import * as mcMirror from "../02_services/mission-control/lib/b2b";
import * as matrixMirror from "../02_services/matrix-runner/b2b";

const MIRRORS: { name: string; mod: typeof canonical }[] = [
  { name: "02_services/mission-control/lib/b2b.ts", mod: mcMirror },
  { name: "02_services/matrix-runner/b2b.ts", mod: matrixMirror },
];

const a = canonical.B2B_PATTERNS;
const problems: string[] = [];

for (const { name, mod } of MIRRORS) {
  if (canonical.BANK_TRANSFER_TYPE_ID !== mod.BANK_TRANSFER_TYPE_ID) {
    problems.push(`${name}: BANK_TRANSFER_TYPE_ID differs from canonical.`);
  }
  const b = mod.B2B_PATTERNS;
  const onlyCanonical = a.filter((p) => !b.includes(p));
  const onlyMirror = b.filter((p) => !a.includes(p));
  if (onlyCanonical.length || onlyMirror.length || a.length !== b.length) {
    problems.push(
      `${name}: B2B_PATTERNS differ (canonical ${a.length} vs mirror ${b.length})\n` +
        (onlyCanonical.length ? `  missing from mirror: ${JSON.stringify(onlyCanonical)}\n` : "") +
        (onlyMirror.length ? `  extra in mirror: ${JSON.stringify(onlyMirror)}` : "")
    );
  }
}

if (problems.length) {
  console.error("❌ B2B classifier drift detected — keep all copies in sync with 03_automation/lib/b2b.ts:\n");
  console.error(problems.join("\n\n"));
  process.exit(1);
}

console.log(`✅ B2B classifier in sync (${a.length} patterns, identical across ${MIRRORS.length + 1} packages).`);
