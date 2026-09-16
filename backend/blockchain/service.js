const fs = require("node:fs");
const path = require("node:path");
const { Contract, FetchRequest, JsonRpcProvider, keccak256, id } = require("ethers");
const database = require("../database");
const { directory, relayer, chainId } = require("./local");
const { ElectionError } = require("../models/Election");
let client;

function configuration() {
  try {
    const config = JSON.parse(fs.readFileSync(process.env.VOTING_DEPLOYMENT_FILE || path.join(directory, "deployment.json"), "utf8"));
    if (!/^[a-f0-9]{64}$/.test(config.encryptionKey) || config.chainId !== chainId) throw new Error("Invalid local configuration");
    return config;
  } catch {
    throw new ElectionError(503, "Voting is not configured. The administrator needs to start and deploy the local blockchain.");
  }
}

async function connect() {
  const config = configuration();
  if (!client || client.config.instanceId !== config.instanceId) {
    client?.provider.destroy();
    const request = new FetchRequest(process.env.VOTING_RPC_URL || "http://127.0.0.1:8545");
    const url = new URL(request.url);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new ElectionError(503, "This prototype requires a local blockchain endpoint.");
    request.timeout = 5000;
    const provider = new JsonRpcProvider(request, chainId, { staticNetwork: true, cacheTimeout: -1 });
    provider.pollingInterval = 250;
    client = { config, provider, wallet: relayer.connect(provider), contract: new Contract(config.address, config.abi, provider) };
  }
  try {
    const actualChain = Number(await client.provider.send("eth_chainId", []));
    const [instance, relay, receipt] = await Promise.all([client.contract.instanceId(), client.contract.relayer(), client.provider.getTransactionReceipt(config.deploymentHash)]);
    if (actualChain !== chainId || instance !== config.instanceId || relay !== relayer.address || receipt?.status !== 1) throw new Error("Deployment mismatch");
    const [saved] = await database.execute("SELECT instance_id FROM chain_lock WHERE id = 1");
    if (saved && saved.instance_id !== config.instanceId) throw new Error("Database deployment mismatch");
    return client;
  } catch {
    throw new ElectionError(503, "The voting ledger is unavailable or differs from this installation. Start or restore the matching local blockchain.");
  }
}

async function lock(query, chain) {
  await query("INSERT IGNORE INTO chain_lock (id, instance_id) VALUES (1, ?)", [chain.config.instanceId]);
  const [row] = await query("SELECT instance_id FROM chain_lock WHERE id = 1 FOR UPDATE");
  if (row.instance_id !== chain.config.instanceId) throw new ElectionError(503, "The database belongs to another voting ledger. Restore the matching deployment.");
}

// Caller holds the chain lock until this durable outbox transaction commits.
// Retry broadcasts the exact same signed bytes, so a lost HTTP response cannot
// create a second ballot. Failed mined transactions can be replaced explicitly.
async function prepare(query, chain, { key, electionId, kind, method, args }) {
  const [existing] = await query("SELECT * FROM chain_transactions WHERE job_key = ?", [key]);
  if (existing && existing.status !== "failed") return existing;
  const [row] = await query("SELECT MAX(nonce) AS maximum FROM chain_transactions");
  const nonce = Math.max(await chain.provider.getTransactionCount(chain.wallet.address, "pending"), row.maximum === null ? 0 : Number(row.maximum) + 1);
  let raw;
  try {
    const data = chain.contract.interface.encodeFunctionData(method, args);
    const transaction = await chain.wallet.populateTransaction({ to: chain.config.address, data, nonce });
    raw = await chain.wallet.signTransaction(transaction);
  } catch {
    throw new ElectionError(503, "The ledger could not prepare this transaction. Check the election schedule and local blockchain, then refresh.");
  }
  const hash = keccak256(raw);
  await query(`INSERT INTO chain_transactions (job_key, election_id, kind, nonce, transaction_hash, raw_transaction)
    VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE nonce = VALUES(nonce), transaction_hash = VALUES(transaction_hash),
    raw_transaction = VALUES(raw_transaction), status = 'pending', block_number = NULL, created_at = UTC_TIMESTAMP(3)`, [key, electionId, kind, nonce, hash, raw]);
  await query("INSERT INTO chain_attempts (transaction_hash, election_id, kind, nonce) VALUES (?, ?, ?, ?)", [hash, electionId, kind, nonce]);
  return { job_key: key, election_id: electionId, kind, nonce, transaction_hash: hash, raw_transaction: raw, status: "pending", block_number: null };
}

async function reconcile(chain, job) {
  let receipt = await chain.provider.getTransactionReceipt(job.transaction_hash);
  if (!receipt && job.status === "pending") {
    try { await chain.provider.broadcastTransaction(job.raw_transaction); }
    catch { /* An accepted, already-known, or temporarily unavailable send needs a receipt check. */ }
    receipt = await chain.provider.getTransactionReceipt(job.transaction_hash);
  }
  if (receipt) {
    job.status = receipt.status === 1 ? "confirmed" : "failed";
    job.block_number = receipt.blockNumber;
    await database.execute("UPDATE chain_transactions SET status = ?, block_number = ? WHERE job_key = ? AND transaction_hash = ?", [job.status, job.block_number, job.job_key, job.transaction_hash]);
    await database.execute("UPDATE chain_attempts SET status = ?, block_number = ? WHERE transaction_hash = ?", [job.status, job.block_number, job.transaction_hash]);
  } else if (job.status !== "pending") {
    throw new ElectionError(503, "A recorded transaction is missing from the ledger. Restore the matching blockchain before continuing.");
  }
  return job;
}

async function flush(chain) {
  const jobs = await database.execute("SELECT * FROM chain_transactions WHERE status = 'pending' ORDER BY nonce LIMIT 100");
  for (const job of jobs) await reconcile(chain, job);
}

async function ensureElection(electionId) {
  const chain = await connect();
  await flush(chain);
  const job = await database.transaction(async query => {
    const [election] = await query("SELECT starts_at AS startsAt, ends_at AS endsAt FROM elections WHERE id = ? FOR UPDATE", [electionId]);
    if (!election) throw new ElectionError(404, "Election not found");
    const [clock] = await query("SELECT UTC_TIMESTAMP(3) AS now");
    if (clock.now < election.startsAt) throw new ElectionError(409, "Voting opens at the scheduled start time");
    const candidates = await query("SELECT id FROM candidates WHERE election_id = ? ORDER BY id", [electionId]);
    const [existing] = await query("SELECT * FROM chain_transactions WHERE job_key = ?", [`election:${electionId}`]);
    if (candidates.length < 2 && !existing) throw new ElectionError(409, "At least two political parties are required to open voting");
    if (candidates.length > 100) throw new ElectionError(409, "An election supports at most 100 parties");
    await lock(query, chain);
    return prepare(query, chain, { key: `election:${electionId}`, electionId, kind: "election", method: "createElection",
      args: [id(electionId), Math.ceil(election.startsAt.getTime() / 1000), Math.floor(election.endsAt.getTime() / 1000), candidates.map(candidate => id(candidate.id))] });
  });
  await reconcile(chain, job);
  if (job.status === "pending") {
    // A periodically mined local chain needs a block before activation is usable.
    try { await chain.provider.waitForTransaction(job.transaction_hash, 1, 4000); } catch { /* Keep the durable pending state on timeout. */ }
    await reconcile(chain, job);
  }
  if (job.status !== "confirmed") throw new ElectionError(503, "Election activation is awaiting ledger confirmation. Refresh in a moment.");
  return chain;
}

function publicReceipt(job, chain) {
  return { status: job.status, transactionHash: job.transaction_hash, blockNumber: job.block_number,
    contractAddress: chain.config.address, chainId, submittedAt: job.created_at ?? null };
}
function close() { client?.provider.destroy(); client = undefined; }
module.exports = { configuration, connect, lock, prepare, reconcile, flush, ensureElection, publicReceipt, close };
