// Regenerates rinne/src/execution/rinne-checker.generated.ts from the forge
// build output. Run after changing RinneChecker.sol: forge build && node export-artifact.cjs
const fs = require("fs");
const art = JSON.parse(fs.readFileSync("out/RinneChecker.sol/RinneChecker.json", "utf8"));
const bytecode = art.bytecode.object;
const selector = art.methodIdentifiers["checkSwap(uint256,uint256,uint256,uint256,uint256)"];
if (!bytecode || !selector) throw new Error("artifact missing fields");
const solcVersion = art.metadata.compiler.version;
const out = `// Generated from rinne-contracts/out/RinneChecker.sol/RinneChecker.json.
// Rebuild with: cd rinne-contracts && forge build && node export-artifact.cjs
// solc ${solcVersion}, optimizer 200 runs.

export const CHECKER_CONTRACT = "RinneChecker";

export const CHECKER_BYTECODE =
  "${bytecode}";

// bytes4(keccak256("checkSwap(uint256,uint256,uint256,uint256,uint256)"))
export const CHECKER_CHECKSWAP_SELECTOR = "0x${selector}";
`;
fs.writeFileSync("../rinne/src/execution/rinne-checker.generated.ts", out);
console.log("wrote rinne/src/execution/rinne-checker.generated.ts");
