-- db/populatedb.sql

-- Drop tables if they exist so we can re-run this script safely if needed
DROP TABLE IF EXISTS items;
DROP TABLE IF EXISTS categories;

-- 1. Create Categories Table
CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT
);

-- 2. Create Items Table with a Foreign Key linked to Categories
CREATE TABLE items (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  category_id INT REFERENCES categories(id) ON DELETE CASCADE,
  price NUMERIC(10, 2) NOT NULL,
  stock_count INT NOT NULL DEFAULT 0
);

-- 3. Insert Initial Dummy Data (Seed data)
INSERT INTO categories (name, description) VALUES 
  ('Kitchen', 'Equipment and utensils used in food preparation'),
  ('Bar', 'Drinks, glassware, and bar tools');

INSERT INTO items (name, description, category_id, price, stock_count) VALUES 
  ('Chef Knife', '8-inch high carbon stainless steel knife', 1, 45.99, 12),
  ('Blender', 'Commercial grade heavy duty blender', 1, 120.50, 4),
  ('Cocktail Shaker', 'Stainless steel Boston shaker set', 2, 15.00, 25);

  
-- 4. Create chat_history table matching itemModel.js expectations
DROP TABLE IF EXISTS chat_history;

CREATE TABLE chat_history (
  id SERIAL PRIMARY KEY,
  user_question TEXT NOT NULL,
  ai_response TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
