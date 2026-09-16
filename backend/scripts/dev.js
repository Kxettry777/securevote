const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const database = require("../database");
const { setupDatabase } = require("./setup-db");
const { startLedger } = require("./chain-node");
const { deploy } = require("./chain-deploy");
const chainService = require("../blockchain/service");
const backend = path.join(__dirname, "..");
const frontend = path.join(__dirname, "../../frontend");
const children = [];
let ledger, stopping = false;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  const running = children.filter(child => child.pid && child.exitCode === null);
  const exits = running.map(child => once(child, "exit").catch(() => {}));
  for (const child of running) child.kill();
  await Promise.all(exits);
  chainService.close();
  await database.close();
  if (ledger) await ledger.close();
  process.exitCode = code;
}
function launch(file, args, cwd) {
  const child = spawn(process.execPath, [file, ...args], { cwd, stdio: "inherit", windowsHide: true,
    env: { ...process.env, API_PROXY_TARGET: `http://127.0.0.1:${Number(process.env.PORT) || 5000}` } });
  children.push(child);
  child.once("error", error => { console.error("Development process failed:", error.code); void stop(1); });
  child.once("exit", code => { if (!stopping) { console.error("A development process stopped. Shutting down the other services."); void stop(code || 0); } });
}
async function main() {
  await setupDatabase();
  ledger = await startLedger();
  await deploy();
  await chainService.connect();
  launch(path.join(backend, "index.js"), [], backend);
  launch(path.join(frontend, "node_modules/vite/bin/vite.js"), ["--host", "127.0.0.1", "--port", "5173", "--strictPort"], frontend);
  console.log("SecureVote is starting at http://127.0.0.1:5173. Press Ctrl+C to stop all services.");
  console.log("Restart this command after backend changes. Frontend changes update automatically.");
}
process.once("SIGINT", () => { void stop(); });
process.once("SIGTERM", () => { void stop(); });
main().catch(async error => { console.error("Local startup failed:", error.code || error.message); await stop(1); });
