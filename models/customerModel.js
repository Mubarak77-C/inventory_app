const pool = require("../db/pool"); // adjust path if your db pool file is elsewhere

function cleanOptionalText(val) {
  if (val === undefined || val === null) return null;
  const trimmed = String(val).trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function createCustomer({
  name,
  email,
  phone,
  addressLine1,
  address_line1,
  addressLine2,
  address_line2,
  extraDetails,
  extra_details,
  createdBy = null,
}) {
  const cleanName = typeof name === "string" ? name.trim() : "";
  if (!cleanName) {
    const err = new Error("Customer name is required.");
    err.statusCode = 400;
    err.code = "CUSTOMER_NAME_REQUIRED";
    throw err;
  }

  const cleanEmail = cleanOptionalText(email);
  const cleanPhone = cleanOptionalText(phone);
  const cleanAddr1 = cleanOptionalText(addressLine1 ?? address_line1);
  const cleanAddr2 = cleanOptionalText(addressLine2 ?? address_line2);
  const cleanExtra = cleanOptionalText(extraDetails ?? extra_details);

  const { rows } = await pool.query(
    `INSERT INTO public.customers
       (name, email, phone, address_line1, address_line2, extra_details, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, email, phone, address_line1, address_line2, extra_details, created_by, created_at, updated_at`,
    [
      cleanName,
      cleanEmail,
      cleanPhone,
      cleanAddr1,
      cleanAddr2,
      cleanExtra,
      createdBy,
    ],
  );

  return rows[0];
}

async function listCustomers(search = "", limit = 100) {
  const q = typeof search === "string" ? search.trim() : "";
  const safeLimit =
    Number.isInteger(Number(limit)) && Number(limit) > 0
      ? Math.min(Number(limit), 200)
      : 100;

  if (!q) {
    const { rows } = await pool.query(
      `SELECT id, name, email, phone, address_line1, address_line2, extra_details, created_at
       FROM public.customers
       ORDER BY id DESC
       LIMIT $1`,
      [safeLimit],
    );
    return rows;
  }

  const pattern = `%${q}%`;
  const { rows } = await pool.query(
    `SELECT id, name, email, phone, address_line1, address_line2, extra_details, created_at
     FROM public.customers
     WHERE name ILIKE $1 OR COALESCE(phone, '') ILIKE $1 OR COALESCE(email, '') ILIKE $1
     ORDER BY id DESC
     LIMIT $2`,
    [pattern, safeLimit],
  );
  return rows;
}

async function getCustomerById(customerId) {
  const id = Number(customerId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const { rows } = await pool.query(
    `SELECT id, name, email, phone, address_line1, address_line2, extra_details, created_at, updated_at
     FROM public.customers
     WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

module.exports = {
  createCustomer,
  listCustomers,
  getCustomerById,
};
