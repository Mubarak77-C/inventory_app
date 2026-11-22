require("dotenv").config();
const bcrypt = require("bcrypt");
const pool = require("./pool");

async function seedUsers() {
  const usersToSeed = [
    {
      username: process.env.SUPERADMIN_USERNAME || "superadmin",
      password: process.env.SUPERADMIN_PASSWORD || "SuperAdmin@1234",
      role: "superadmin",
    },
    {
      username: process.env.ADMIN_USERNAME || "admin",
      password: process.env.ADMIN_PASSWORD || "Admin@1234",
      role: "admin",
    },
    {
      username: process.env.CASHIER_USERNAME || "cashier1",
      password: process.env.CASHIER_PASSWORD || "Cashier@1234",
      role: "cashier",
    },
  ];

  try {
    for (const u of usersToSeed) {
      const hash = await bcrypt.hash(u.password, 12);
      await pool.query(
        `INSERT INTO users (username, password_hash, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (username) DO NOTHING`,
        [u.username, hash, u.role],
      );
      console.log(`User '${u.username}' (${u.role}) ready.`);
    }
  } catch (err) {
    console.error("Failed to seed users:", err);
  } finally {
    await pool.end();
  }
}

seedUsers();
