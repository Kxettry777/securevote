const express = require("express");
const Voting = require("../models/Voting");
const { ElectionError } = require("../models/Election");
const User = require("../models/User");
const { requireAuth, requireRole } = require("../middleware/auth");
const router = express.Router();
router.use(requireAuth);
router.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
router.param("id", (req, res, next, value) => User.isValidId(value) ? next() : res.status(400).json({ message: "Invalid election identifier" }));
const handle = action => async (req, res) => {
  try { await action(req, res); }
  catch (error) {
    if (error instanceof ElectionError) return res.status(error.status).json({ message: error.message });
    // Never log credentials, signed requests, candidate choices, or voter IDs.
    console.error("Voting request failed:", error.code || error.name);
    res.status(503).json({ message: "Voting is temporarily unavailable. Refresh transaction status before trying again." });
  }
};
router.post("/:id/credentials", requireRole("voter"), handle(async (req, res) => res.status(201).json(await Voting.issue(req.params.id, req.account))));
router.post("/:id/ballots", requireRole("voter"), handle(async (req, res) => {
  const partyId = req.body?.partyId ?? req.body?.candidateId;
  if (!User.isValidId(partyId) || typeof req.body?.credential !== "string" || !/^[a-f0-9]{64}$/.test(req.body.credential)) throw new ElectionError(400, "Choose a party and supply a valid voting credential");
  const receipt = await Voting.cast(req.params.id, req.account, partyId, req.body.credential);
  res.status(receipt.status === "pending" ? 202 : 200).json(receipt);
}));
router.get("/:id/ballot", requireRole("voter"), handle(async (req, res) => res.json(await Voting.status(req.params.id, req.account))));
router.get("/:id/results", requireRole("admin", "voter", "auditor", "candidate", "party"), handle(async (req, res) => res.json(await Voting.results(req.params.id, req.account))));
module.exports = router;
