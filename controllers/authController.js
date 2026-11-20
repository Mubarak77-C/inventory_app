const bcrypt = require("bcrypt");
const pool = require("../db/pool");
// Pre-computed dummy bcrypt hash so unknown usernames take the exact same time as wrong passwords
const DUMMY_HASH =
  "$2b$12$CwTycUXWue0Thq9StjUM0uJ8.jZ7tJ1wW6P7rX8q9y0z1A2B3C4D5";

const user = result.rows;
const hashToCheck = user ? user.password_hash : DUMMY_HASH;
const isMatch = await bcrypt.compare(password || "", hashToCheck);

if (!user || !isMatch) {
  return res.status(401).render("login", {
    title: "Admin Login",
    error: "Invalid username or password.",
  });
}

exports.getLoginForm = (req, res) => {
  if (req.session?.userId) return res.redirect("/");
  res.render("login", { title: "Admin Login", error: null });
};

exports.postLogin = async (req, res, next) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [
      username?.trim(),
    ]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password || "", user.password_hash))) {
      return res.status(401).render("login", {
        title: "Admin Login",
        error: "Invalid username or password.",
      });
    }

    // Regenerate session ID on login to prevent Session Fixation attacks
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.role = user.role;
      res.redirect("/");
    });
  } catch (err) {
    next(err);
  }
};

exports.postLogout = (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("connect.sid");
    res.redirect("/login");
  });
};
