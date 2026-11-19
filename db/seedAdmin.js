require("dotenv").config();
const bcrypt = require("bcrypt");
const pool = require("./pool"); // adjust path if your pool file is named differently

async function seedAdmin() {
  const username = process.env.ADMIN_USERNAME || "admin";
  const plainPassword = process.env.ADMIN_PASSWORD || "Admin@1234";

  try {
    const hash = await bcrypt.hash(plainPassword, 12);
    await pool.query(
      `INSERT INTO users (username, password_hash, role)
       VALUES ($1, $2, 'admin')
       ON CONFLICT (username) DO NOTHING`,
      [username, hash],
    );
    console.log(`Admin user '${username}' ready.`);
  } catch (err) {
    console.error("Failed to seed admin:", err);
  } finally {
    await pool.end();
  }
}

seedAdmin();
