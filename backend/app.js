const express = require("express");
const cors = require("cors");
const database = require("./database");
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const electionRoutes = require("./routes/elections");

const app = express();
app.disable("x-powered-by");
app.use("/api", (req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
app.use(cors());
const json = express.json({ limit: "16kb" });
app.use((req, res, next) => req.path.startsWith("/api/registry") ? next() : json(req, res, next));

app.get("/api/health", async (req, res) => {
  res.json({
    status: "ok",
    service: "securevote-api",
    database: await database.isAvailable() ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api", async (req, res, next) => {
  if (!await database.isAvailable()) {
    return res.status(503).json({ message: "The database is unavailable. Please try again later." });
  }
  next();
});
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/registry", require("./routes/registry"));
app.use("/api/elections", require("./routes/voting"));
app.use("/api/elections", electionRoutes);
app.use("/api", (req, res) => res.status(404).json({ message: "API endpoint not found" }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status === 400 || error.status === 413 ? error.status : 500;
  return res.status(status).json({ message: status === 400 ? "Invalid JSON request" : status === 413 ? "Request is too large" : "The request could not be completed" });
});

module.exports = app;
