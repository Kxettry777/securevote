const fs = require("node:fs");
const path = require("node:path");
const solc = require("solc");

function compile() {
  const source = fs.readFileSync(path.join(__dirname, "../../blockchain/contracts/SecureVote.sol"), "utf8");
  const output = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: { "SecureVote.sol": { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "shanghai", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } })));
  const errors = (output.errors || []).filter(error => error.severity === "error");
  if (errors.length) throw new Error(errors.map(error => error.formattedMessage).join("\n"));
  const contract = output.contracts["SecureVote.sol"].SecureVote;
  return { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` };
}
if (require.main === module) { compile(); console.log("SecureVote contract compiled successfully"); }
module.exports = { compile };
