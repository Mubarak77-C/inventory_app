function requireRole(...allowedRoles) {
  return (req, res, next) => {
    // 1. Not logged in -> 401 / redirect to /login
    if (!req.session || !req.session.userId) {
      if (req.headers.accept?.includes("application/json") || req.xhr) {
        return res.status(401).json({ error: "Authentication required." });
      }
      return res.redirect("/login");
    }

    // 2. Logged in, but role is not allowed -> 403 Forbidden
    if (!allowedRoles.includes(req.session.role)) {
      if (req.headers.accept?.includes("application/json") || req.xhr) {
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

// Keep requireAdmin as a convenient shortcut so existing routes don't break!
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
