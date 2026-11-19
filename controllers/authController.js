const bcrypt = require("bcrypt");
const pool = require("../db/pool");

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
