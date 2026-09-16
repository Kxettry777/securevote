const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { JsonRpcProvider, Contract, ContractFactory } = require("ethers");
const { directory, relayer, chainId } = require("../blockchain/local");
const { compile } = require("./chain-compile");

async function main() {
  const provider = new JsonRpcProvider("http://127.0.0.1:8545");
  try {
    if (Number((await provider.getNetwork()).chainId) !== chainId) throw new Error("Expected the SecureVote local chain (31337)");
    const file = path.join(directory, "deployment.json");
    let existing;
    try { existing = JSON.parse(await fs.readFile(file, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (existing) {
      const contract = new Contract(existing.address, existing.abi, provider);
      if (await contract.instanceId() !== existing.instanceId) throw new Error("The ledger differs from the saved deployment. Restore the matching ledger; do not reset an election in progress.");
      console.log(`Existing SecureVote contract verified: ${existing.address}`);
      return;
    }
    const artifact = compile();
    const instanceId = `0x${randomBytes(32).toString("hex")}`;
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, await provider.getSigner(0));
    const contract = await factory.deploy(relayer.address, instanceId);
    const receipt = await contract.deploymentTransaction().wait();
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(file, JSON.stringify({ address: await contract.getAddress(), instanceId, chainId, deploymentHash: receipt.hash,
      deploymentBlock: receipt.blockNumber, encryptionKey: randomBytes(32).toString("hex"), abi: artifact.abi }, null, 2), { flag: "wx" });
    console.log(`SecureVote deployed: ${await contract.getAddress()}`);
    console.log("Keep blockchain/.local backed up together with MySQL. It contains the ledger and credential encryption key.");
  } finally { provider.destroy(); }
}
if (require.main === module) main().catch(error => { console.error("Deployment failed:", error.code || error.message); process.exitCode = 1; });
module.exports = { deploy: main };
