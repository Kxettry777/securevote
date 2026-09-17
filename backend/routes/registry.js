const express = require("express");
const sharp = require("sharp");
const bcrypt = require("bcryptjs");
const Registry = require("../models/Registry");
const { ElectionError } = require("../models/Election");
const User = require("../models/User");
const { normalizeBanner } = require("../media/banner");
const electionSymbols = require("../media/election-symbols.json");
const { requireAuth, requireRole } = require("../middleware/auth");
const router = express.Router();
router.use(requireAuth, requireRole("admin", "party"), express.json({ limit: "6mb" }));
const handle = action => async (req, res) => {
  try { await action(req, res); }
  catch (error) {
    if (error instanceof ElectionError) return res.status(error.status).json({ message: error.message });
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "This party name, account email, role name, rank, or nomination already exists. Each party may nominate only one candidate per role." });
    console.error("Registry request failed:", error.code || error.message);
    res.status(500).json({ message: "The registry request could not be completed" });
  }
};
function text(value, label, min, max) {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) throw new ElectionError(400, `${label} must be between ${min} and ${max} characters`);
  return value.trim();
}
function identifier(value) {
  if (!User.isValidId(value)) throw new ElectionError(400, "Choose a valid party and role");
  return value;
}
router.param("id", (req, res, next, id) => User.isValidId(id) ? next() : res.status(400).json({ message: "Invalid identifier" }));
router.get("/", handle(async (req, res) => res.json(await Registry.list(req.account))));
router.get("/symbols", (req, res) => res.json({ symbols: electionSymbols }));
async function party(req, res) {
  const body = req.body;
  const chosenSymbol = body?.symbolId === undefined ? null : electionSymbols.find(symbol => symbol.id === body.symbolId);
  if (body?.symbolId !== undefined && !chosenSymbol) throw new ElectionError(400, "Choose an election symbol from the available options");
  const data = { name: text(body?.name, "Party name", 2, 120), shortName: text(body?.shortName ?? "", "Abbreviation", 0, 16), symbol: chosenSymbol?.name ?? text(body?.symbol, "Symbol name", 1, 60), manifesto: text(body?.manifesto ?? "", "Manifesto", 0, 4000) };
  if (chosenSymbol) data.symbolImage = Buffer.from(chosenSymbol.image.split(",")[1], "base64");
  if (!req.params.id) {
    data.email = text(body?.email, "Account email", 3, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new ElectionError(400, "Enter a valid party account email");
    if (typeof body?.password !== "string" || body.password.length < 8 || Buffer.byteLength(body.password, "utf8") > 72) throw new ElectionError(400, "Password must be at least 8 characters and at most 72 UTF-8 bytes");
    data.passwordHash = await bcrypt.hash(body.password, 12);
  }
  if (!chosenSymbol && body?.symbolImage !== undefined) {
    const match = typeof body.symbolImage === "string" && /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.symbolImage);
    if (!match) throw new ElectionError(400, "Upload a PNG, JPEG, or WebP election symbol");
    const normalized = await normalizeBanner(Buffer.from(match[2], "base64"), match[1]);
    data.symbolImage = await sharp(normalized).resize({ width: 256, height: 256, fit: "inside", withoutEnlargement: true }).webp().toBuffer();
  }
  res.status(req.params.id ? 200 : 201).json(await Registry.saveParty(req.params.id, data, req.account));
}
async function role(req, res) {
  const rank = req.body?.rank;
  if (!Number.isInteger(rank) || rank < 1 || rank > 100) throw new ElectionError(400, "Hierarchy rank must be a whole number from 1 to 100");
  res.status(req.params.id ? 200 : 201).json(await Registry.saveRole(req.params.id, { partyId: identifier(req.body?.partyId), name: text(req.body?.name, "Role name", 2, 80), rank }, req.account));
}
async function candidate(req, res) {
  const body = req.body;
  res.status(req.params.id ? 200 : 201).json(await Registry.saveCandidate(req.params.id, {
    partyId: identifier(body?.partyId), roleId: identifier(body?.roleId), fullName: text(body?.fullName, "Candidate name", 2, 120), biography: text(body?.biography ?? "", "Biography", 0, 4000),
  }, req.account));
}
router.post("/parties", requireRole("admin"), handle(party));
router.patch("/parties/:id", requireRole("admin"), handle(party));
router.delete("/parties/:id", requireRole("admin"), handle(async (req, res) => {
  if (req.body?.confirmation !== "DELETE") throw new ElectionError(400, "Type DELETE to confirm party deletion");
  await Registry.removeParty(req.params.id, req.account);
  res.json({ message: "Party deleted. Its account is disabled; existing elections and results are preserved." });
}));
router.post("/roles", requireRole("admin"), handle(role));
router.patch("/roles/:id", requireRole("admin"), handle(role));
router.post("/candidates", requireRole("party"), handle(candidate));
router.patch("/candidates/:id", requireRole("party"), handle(candidate));
router.delete("/candidates/:id", requireRole("party"), handle(async (req, res) => { await Registry.removeCandidate(req.params.id, req.account); res.json({ message: "Candidate removed from the registry. Existing ballots are unchanged." }); }));
router.post("/submit", requireRole("party"), handle(async (req, res) => { await Registry.submit(req.account); res.json({ message: "Candidate roster submitted for election preparation" }); }));
module.exports = router;
