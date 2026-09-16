const jwt = require("jsonwebtoken");
const User = require("../models/User");

async function requireAuth(req, res, next) {
  const authorization = req.headers.authorization;
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }

  let claims;
  try {
    claims = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    if (!User.isValidId(claims.sub)) throw new Error("Invalid subject");
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }

  try {
    const user = await User.findById(claims.sub);
    if (!user) return res.status(401).json({ message: "User account no longer exists" });
    if (user.role === "voter" && !user.isApproved) {
      return res.status(403).json({ message: "Your account is awaiting admin approval" });
    }
    req.user = { sub: user.id, role: user.role };
    req.account = user;
    return next();
  } catch {
    return res.status(503).json({ message: "Account verification is unavailable. Please try again." });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    return next();
  };
}

module.exports = { requireAuth, requireRole };
