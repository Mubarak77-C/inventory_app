function requireAdmin(req, res, next) {
  if (req.session && req.session.userId && req.session.role === "admin") {
    return next();
  }

  // Return JSON 401 for API/fetch calls, or redirect browser users to /login
  if (req.headers.accept?.includes("application/json") || req.xhr) {
    return res
      .status(401)
      .json({ error: "Unauthorized. Admin login required." });
  }

  return res.redirect("/login");
}

// Makes currentUser available in all EJS templates automatically
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

module.exports = { requireAdmin, attachUserToLocals };
