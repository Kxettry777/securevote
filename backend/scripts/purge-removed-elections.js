const database = require("../database");
const Election = require("../models/Election");

async function purgeRemovedElections() {
  const removed = await database.execute("SELECT election_id AS id, removed_by AS actorId FROM removed_elections ORDER BY election_id");
  for (const election of removed) {
    await Election.remove(election.id, { id: election.actorId, role: "admin" });
  }
  return removed.length;
}

if (require.main === module) {
  (async () => {
    if (!process.argv.includes("--confirm=DELETE")) throw new Error("Pass --confirm=DELETE to permanently delete previously removed elections and their local election data.");
    try {
      console.log(`Permanently deleted ${await purgeRemovedElections()} previously removed elections.`);
    } finally { await database.close(); }
  })().catch(error => {
    console.error("Election cleanup stopped:", error.code || error.message);
    process.exitCode = 1;
  });
}

module.exports = { purgeRemovedElections };
