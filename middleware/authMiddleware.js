function wantsJson(req) {
  return Boolean(req.xhr || req.headers.accept?.includes("application/json"));
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    // 1. Not logged in -> 401 JSON or redirect to /login
    if (!req.session || !req.session.userId) {
      if (wantsJson(req)) {
        return res.status(401).json({ error: "Authentication required." });
      }
      return res.redirect("/login");
    }

    // 2. Superadmin gets full bypass across role-protected routes
    if (req.session.role === "superadmin") {
      return next();
    }

    // 3. Logged in, but role is not in allowedRoles -> 403 Forbidden
    if (!allowedRoles.includes(req.session.role)) {
      if (wantsJson(req)) {
        return res.status(403).json({
          error: `Access denied. Requires role: ${allowedRoles.join(" or ")}.`,
        });
      }
      return res
        .status(403)
        .send(
          "403 Forbidden: Your role does not have permission for this action.",
        );
    }

    return next();
  };
}

// Keep requireAdmin as a shortcut for admin-only routes (superadmin also passes via requireRole)
const requireAdmin = requireRole("admin");

function attachUserToLocals(req, res, next) {
  res.locals.currentUser = req.session?.userId
    ? {
        id: req.session.userId,
        username: req.session.username,
        role: req.session.role,
      }
    : null;
  next();
}

module.exports = { requireRole, requireAdmin, attachUserToLocals };
