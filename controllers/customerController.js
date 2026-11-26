// controllers/customerController.js
const { createCustomer, listCustomers } = require("../models/customerModel");

async function getCustomers(req, res, next) {
  try {
    const customers = await listCustomers(req.query.q, req.query.limit);
    return res.status(200).json({ customers });
  } catch (err) {
    return next(err);
  }
}

async function postCustomer(req, res, next) {
  try {
    const createdBy = req.user?.id ?? req.session?.userId ?? null;
    const customer = await createCustomer({
      ...req.body,
      createdBy,
    });
    return res.status(201).json({ customer });
  } catch (err) {
    if (err.statusCode === 400) {
      return res
        .status(400)
        .json({ code: err.code || "BAD_REQUEST", error: err.message });
    }
    return next(err);
  }
}

module.exports = { getCustomers, postCustomer };
