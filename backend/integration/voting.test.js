const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { randomUUID, randomBytes } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const ganache = require("ganache");
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
const { JsonRpcProvider, ContractFactory, id } = require("ethers");
const database = require("../database");
const { setupDatabase } = require("../scripts/setup-db");
const { compile } = require("../scripts/chain-compile");
const { mnemonic, relayer, chainId } = require("../blockchain/local");
const chainService = require("../blockchain/service");
const User = require("../models/User");
const app = require("../app");

test("complete voting workflow with real MySQL, HTTP, and Ethereum receipts", { timeout: 120000 }, async t => {
  const previous = { ...process.env };
  const databaseName = `securevote_test_${randomUUID().replaceAll("-", "")}`;
  process.env.MYSQL_DATABASE = databaseName;
  process.env.JWT_SECRET = "voting-integration-test-only";
  process.env.NODE_ENV = "test";
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "securevote-test-"));
  const configFile = path.join(folder, "deployment.json");
  const ledger = ganache.server({ wallet: { mnemonic }, chain: { chainId, hardfork: "shanghai" }, logging: { quiet: true } });
  let server, provider;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    chainService.close();
    provider?.destroy();
    await ledger.close();
    await database.close();
    assert.match(databaseName, /^securevote_test_[0-9a-f]{32}$/);
    const { database: ignored, ...options } = database.config();
    const connection = await mysql.createConnection(options);
    try { await connection.query(`DROP DATABASE IF EXISTS \`${databaseName}\``); } finally { await connection.end(); }
    await fs.rm(configFile, { force: true });
    await fs.rmdir(folder);
    for (const key of ["MYSQL_DATABASE", "JWT_SECRET", "VOTING_RPC_URL", "VOTING_DEPLOYMENT_FILE", "NODE_ENV"]) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  });
  await setupDatabase();
  await setupDatabase();
  await ledger.listen(0, "127.0.0.1");
  process.env.VOTING_RPC_URL = `http://127.0.0.1:${ledger.address().port}`;
  provider = new JsonRpcProvider(process.env.VOTING_RPC_URL, undefined, { cacheTimeout: -1 });
  const artifact = compile();
  const instanceId = `0x${randomBytes(32).toString("hex")}`;
  const contract = await new ContractFactory(artifact.abi, artifact.bytecode, await provider.getSigner(0)).deploy(relayer.address, instanceId);
  const deployment = await contract.deploymentTransaction().wait();
  const config = { address: await contract.getAddress(), instanceId, chainId, deploymentHash: deployment.hash, deploymentBlock: deployment.blockNumber, abi: artifact.abi, encryptionKey: randomBytes(32).toString("hex") };
  await fs.writeFile(configFile, JSON.stringify(config));
  process.env.VOTING_DEPLOYMENT_FILE = configFile;
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  async function request(route, method = "GET", body, token) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${route}`, { method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  async function account(role, name) {
    const user = await User.create({ fullName: name, email: `${name}@example.com`, passwordHash: "test-only", role, isApproved: true });
    return { ...user, token: jwt.sign({ sub: user.id }, process.env.JWT_SECRET) };
  }
  const admin = await account("admin", "administrator");
  const voter = await account("voter", "voter");
  const second = await account("voter", "second");
  const third = await account("voter", "third");
  const outsider = await account("voter", "outsider");
  const auditor = await account("auditor", "auditor");
  const { parties } = await require("./registry-fixtures")(request, admin.token, 3);
  const schedule = { partyIds: parties.map(p => p.id), title: "Voting integration", startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: new Date(Date.now() + 7200000).toISOString() };
  const created = await request("/elections", "POST", schedule, admin.token);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const electionId = created.data.election.id, base = `/elections/${electionId}`;
  const [candidate, other, thirdParty] = created.data.parties;
  for (const user of [voter, second, third]) assert.equal((await request(`${base}/voters`, "POST", { voterId: user.id }, admin.token)).status, 201);
  let credential, firstReceipt;

  await t.test("a one-party election cannot issue credentials or open voting", async () => {
    assert.equal((await request("/elections", "POST", { ...schedule, partyIds: [parties[0].id] }, admin.token)).status, 400);
    // Reproduce an incomplete historical election without using the new creation API.
    const historicalId = randomUUID();
    await database.execute("INSERT INTO elections (id, title, description, starts_at, ends_at, created_by) VALUES (?, 'Historical election', '', ?, ?, ?)", [historicalId, new Date(schedule.startsAt), new Date(schedule.endsAt), admin.id]);
    await database.execute("INSERT INTO candidates (id, election_id, name, manifesto) VALUES (?, ?, 'Only party', '')", [randomUUID(), historicalId]);
    const invalid = { data: { election: { id: historicalId } } };
    const route = `/elections/${historicalId}`;
    await request(`${route}/voters`, "POST", { voterId: voter.id }, admin.token);
    await database.execute("UPDATE elections SET starts_at = UTC_TIMESTAMP(3) - INTERVAL 10 SECOND WHERE id = ?", [invalid.data.election.id]);
    const blocked = await request(`${route}/credentials`, "POST", undefined, voter.token);
    assert.equal(blocked.status, 409);
    assert.match(blocked.data.message, /two political parties/);
    await database.execute("UPDATE elections SET ends_at = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE id = ?", [invalid.data.election.id]);
    const result = await request(`${route}/results`, "GET", undefined, voter.token);
    assert.equal(result.data.status, "insufficient_parties");
    assert.equal(result.data.totalVotes, 0);
  });

  await t.test("credentials enforce role, assignment, and schedule; results stay closed", async () => {
    assert.equal((await request(`${base}/credentials`, "POST")).status, 401);
    assert.equal((await request(`${base}/credentials`, "POST", undefined, admin.token)).status, 403);
    assert.equal((await request(`${base}/credentials`, "POST", undefined, outsider.token)).status, 404);
    assert.equal((await request(`${base}/credentials`, "POST", undefined, voter.token)).status, 409);
    assert.equal((await request(`${base}/results`, "GET", undefined, auditor.token)).status, 409);
    const detail = await request(base, "GET", undefined, auditor.token);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.voters, undefined);
    assert.equal((await request(`${base}/ballot`, "GET", undefined, auditor.token)).status, 403);
    await database.execute("UPDATE elections SET starts_at = UTC_TIMESTAMP(3) - INTERVAL 10 SECOND WHERE id = ?", [electionId]);
    const issued = await request(`${base}/credentials`, "POST", undefined, voter.token);
    assert.equal(issued.status, 201, JSON.stringify(issued.data));
    credential = issued.data.credential;
    assert.match(credential, /^[a-f0-9]{64}$/);
    const [stored] = await database.execute("SELECT * FROM voting_credentials WHERE voter_id = ?", [voter.id]);
    assert.equal(JSON.stringify(stored).includes(credential), false);
    assert.equal(stored.token_hash.length, 64);
  });
  await t.test("candidate ownership, malformed credentials, stolen credentials, expiry, and revocation", async () => {
    assert.equal((await request(`${base}/ballots`, "POST", { candidateId: randomUUID(), credential }, voter.token)).status, 400);
    assert.equal((await request(`${base}/ballots`, "POST", { candidateId: candidate.id, credential: {} }, voter.token)).status, 400);
    assert.equal((await request(`${base}/ballots`, "POST", { candidateId: candidate.id, credential }, second.token)).status, 400);
    await database.execute("UPDATE voting_credentials SET expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE voter_id = ?", [voter.id]);
    assert.equal((await request(`${base}/ballots`, "POST", { candidateId: candidate.id, credential }, voter.token)).status, 409);
    const replacement = await request(`${base}/credentials`, "POST", undefined, voter.token);
    assert.equal(replacement.status, 201);
    const old = credential; credential = replacement.data.credential;
    assert.equal((await request(`${base}/ballots`, "POST", { candidateId: candidate.id, credential: old }, voter.token)).status, 400);
    await User.setVoterApproval(voter.id, false);
    assert.equal((await request(`${base}/ballots`, "POST", { candidateId: candidate.id, credential }, voter.token)).status, 403);
    await User.setVoterApproval(voter.id, true);
  });
  await t.test("concurrent duplicate submissions return one transaction and one vote", async () => {
    const attempts = await Promise.all([candidate, other].map(choice => request(`${base}/ballots`, "POST", { candidateId: choice.id, credential }, voter.token)));
    for (const attempt of attempts) assert.equal(attempt.status, 200, JSON.stringify(attempt.data));
    assert.equal(attempts[0].data.transactionHash, attempts[1].data.transactionHash);
    firstReceipt = attempts[0].data;
    assert.equal(firstReceipt.status, "confirmed");
    assert.equal((await provider.getTransactionReceipt(firstReceipt.transactionHash)).status, 1);
    assert.equal((await contract.queryFilter(contract.filters.BallotAccepted(id(electionId)))).length, 1);
    assert.equal((await request(`${base}/credentials`, "POST", undefined, voter.token)).status, 409);
    assert.equal(JSON.stringify(firstReceipt).includes(voter.id), false);
    assert.equal(JSON.stringify(firstReceipt).includes("candidate"), false);
  });
  await t.test("saved transactions recover after interrupted broadcast and pool reconnection", async () => {
    const issued = await request(`${base}/credentials`, "POST", undefined, second.token);
    assert.equal(issued.status, 201);
    const chain = await chainService.connect();
    const broadcast = t.mock.method(chain.provider, "broadcastTransaction", async () => { throw new Error("Simulated interrupted broadcast"); });
    const pending = await request(`${base}/ballots`, "POST", { candidateId: candidate.id, credential: issued.data.credential }, second.token);
    assert.equal(pending.status, 202, JSON.stringify(pending.data));
    assert.equal(pending.data.status, "pending");
    broadcast.mock.restore();
    chainService.close();
    await database.close();
    const recovered = await request(`${base}/ballot`, "GET", undefined, second.token);
    assert.equal(recovered.data.status, "confirmed", JSON.stringify(recovered.data));
    assert.equal(recovered.data.transactionHash, pending.data.transactionHash);
    assert.equal((await request(`${base}/credentials`, "POST", undefined, second.token)).status, 409);
  });
  await t.test("a mined failure is not success and can be explicitly retried", async () => {
    const issued = await request(`${base}/credentials`, "POST", undefined, third.token);
    const chain = await chainService.connect();
    // Let preparation succeed, then mine the submitted transaction after expiry.
    const original = chain.provider.broadcastTransaction.bind(chain.provider);
    const broadcast = t.mock.method(chain.provider, "broadcastTransaction", async raw => {
      await provider.send("evm_increaseTime", [301]);
      return original(raw);
    });
    const failed = await request(`${base}/ballots`, "POST", { candidateId: other.id, credential: issued.data.credential }, third.token);
    broadcast.mock.restore();
    assert.equal(failed.data.status, "failed", JSON.stringify(failed.data));
    // Restore the test chain's wall clock before issuing a replacement.
    await provider.send("evm_setTime", [Date.now()]);
    await provider.send("evm_mine", []);
    assert.ok(Math.abs((await provider.getBlock("latest")).timestamp - Math.floor(Date.now() / 1000)) < 5);
    const replacement = await request(`${base}/credentials`, "POST", undefined, third.token);
    assert.equal(replacement.status, 201);
    const retry = await request(`${base}/ballots`, "POST", { partyId: thirdParty.id, credential: replacement.data.credential }, third.token);
    assert.equal(retry.data.status, "confirmed", JSON.stringify(retry.data));
    assert.notEqual(retry.data.transactionHash, failed.data.transactionHash);
  });
  await t.test("closed results reconcile all ballots and preserve voter privacy", async () => {
    await database.execute("UPDATE elections SET ends_at = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE id = ?", [electionId]);
    await provider.send("evm_increaseTime", [7300]);
    await provider.send("evm_mine", []);
    assert.equal((await request(`${base}/credentials`, "POST", undefined, voter.token)).status, 409);
    assert.equal((await request(`${base}/ballots`, "POST", { candidateId: candidate.id, credential }, voter.token)).status, 409);
    const result = await request(`${base}/results`, "GET", undefined, auditor.token);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.status, "verified");
    assert.equal(result.data.totalVotes, 3);
    assert.equal(result.data.candidates.length, 3);
    assert.equal(result.data.candidates.find(party => party.id === thirdParty.id).votes, 1);
    assert.equal(result.data.audit.ballotEvents, 3);
    assert.equal(result.data.audit.failedTransactions, 1);
    assert.equal(result.data.receipts.length, 3);
    for (const user of [voter, second, third]) { assert.equal(JSON.stringify(result.data).includes(user.id), false); assert.equal(JSON.stringify(result.data).includes(user.email), false); }
    assert.equal((await request(`${base}/results`, "GET", undefined, outsider.token)).status, 404);
    const status = await request(`${base}/ballot`, "GET", undefined, voter.token);
    assert.equal(status.data.transactionHash, firstReceipt.transactionHash);
  });
  await t.test("removing and restoring an ended election preserves confirmed blockchain results", async () => {
    const before = (await request(`${base}/results`, "GET", undefined, admin.token)).data;
    assert.equal((await request(base, "DELETE", undefined, admin.token)).status, 200);
    assert.equal((await request(`${base}/results`, "GET", undefined, voter.token)).status, 404);
    const removed = await request(`${base}/results`, "GET", undefined, admin.token);
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.data.parties, before.parties);
    assert.equal(removed.data.totalVotes, before.totalVotes);
    assert.equal(removed.data.status, "verified");
    assert.equal((await request(`${base}/restore`, "POST", undefined, admin.token)).status, 200);
    const restored = await request(`${base}/results`, "GET", undefined, voter.token);
    assert.equal(restored.status, 200);
    assert.equal(restored.data.totalVotes, before.totalVotes);
  });

  await t.test("deleting a registered party preserves confirmed votes and published results", async () => {
    const before = (await request(`${base}/results`, "GET", undefined, admin.token)).data;
    assert.equal((await request(`/registry/parties/${parties[0].id}`, "DELETE", { confirmation: "DELETE" }, admin.token)).status, 200);
    const after = await request(`${base}/results`, "GET", undefined, voter.token);
    assert.equal(after.status, 200);
    assert.equal(after.data.status, "verified");
    assert.equal(after.data.totalVotes, before.totalVotes);
    assert.deepEqual(after.data.parties, before.parties);
    assert.deepEqual(after.data.receipts, before.receipts);
    assert.equal((await request(`${base}/ballot`, "GET", undefined, voter.token)).data.transactionHash, firstReceipt.transactionHash);
  });

  await t.test("a changed ledger configuration fails closed", async () => {
    await database.execute("UPDATE chain_lock SET instance_id = ? WHERE id = 1", [`0x${randomBytes(32).toString("hex")}`]);
    assert.equal((await request(`${base}/results`, "GET", undefined, admin.token)).status, 503);
  });
});
