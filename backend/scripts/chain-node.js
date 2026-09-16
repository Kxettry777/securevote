const fs = require("node:fs/promises");
const path = require("node:path");
const ganache = require("ganache");
const { directory, mnemonic, chainId } = require("../blockchain/local");

async function startLedger() {
  await fs.mkdir(directory, { recursive: true });
  const server = ganache.server({
    chain: { chainId, hardfork: "shanghai" },
    // Keep block.timestamp advancing even when nobody submits a transaction.
    miner: { blockTime: 1 },
    database: { dbPath: path.join(directory, "ledger") },
    wallet: { mnemonic, totalAccounts: 3 },
    logging: { quiet: true },
  });
  await server.listen(8545, "127.0.0.1");
  console.log("SecureVote local blockchain: http://127.0.0.1:8545 (persistent ledger)");
  return server;
}
if (require.main === module) startLedger().then(server => {
  const stop = async () => { await server.close(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}).catch(error => { console.error("Local blockchain failed:", error.code || error.message); process.exitCode = 1; });
module.exports = { startLedger };
