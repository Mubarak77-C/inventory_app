# 📦 AI-Powered Inventory Management System

A full-stack inventory management web application built with **Node.js, Express, PostgreSQL (`pgvector`), EJS, and Google Gemini AI**, containerized with **Docker Compose**.

It combines traditional CRUD inventory tracking with **hybrid AI semantic search**, **multimodal image-to-item scanning**, **vector-based similar product recommendations**, and a **Retrieval-Augmented Generation (RAG) AI Inventory Assistant**.

---

## ✨ Key Features

- **Hybrid AI Semantic Search (`pgvector` + Gemini Embeddings):**
  - Search inventory by **meaning and use-case** (e.g., _"cutting vegetables"_ → matches **Chef Knife**) rather than exact keyword matching alone.
  - Combines cosine similarity (`1 - (embedding <=> $1::vector)`) with a tuned similarity cutoff (`0.57`), SQL `ILIKE` keyword fallback, **Category** filtering, and **Max Price** filtering.
  - Indexed with a **`pgvector` HNSW cosine index** (`vector_cosine_ops`) for fast nearest-neighbor retrieval.
- **Vector RAG AI Chatbot Assistant (`/items/chatbot`):**
  - Embeds user questions, retrieves the most relevant inventory records from PostgreSQL via `pgvector`, and answers stock, pricing, and product questions grounded strictly in live database records.
  - Built-in exponential backoff retry logic (`generateWithRetry`) for transient API traffic spikes.
  - Persists conversation history alongside inventory state snapshots.
- **Multimodal Image-to-Item Scanner (`/items/new`):**
  - Upload a product photo or invoice to auto-fill **Item Name, Description, Category, Price, and Stock Count** via Gemini Vision, and automatically generate its vector embedding on save.
- **AI Similar / Related Product Recommendations (`/items/:id/edit`):**
  - Recommends related inventory items with match percentages using pure `pgvector` SQL cosine distance (`<=>`) with zero extra AI API calls.
- **Executive Analytics & Restock Advisor:**
  - Real-time total asset valuation, category stock/value breakdown charts (**Chart.js**), PDF inventory export, and low-stock AI restock recommendations.
- **Containerized Development Environment:**
  - Multi-container setup running Node.js (`nodemon`) and PostgreSQL 15 (`pgvector/pgvector:pg15`) with filter-preserving pagination and custom 404 error handling.

---

## 🛠️ Tech Stack

- **Backend:** Node.js, Express.js, EJS
- **Database & Vector Engine:** PostgreSQL 15, `pgvector` (HNSW indexing + cosine distance)
- **AI & Embeddings:** Google Gemini API (`@google/genai`) — Embeddings, Vision extraction, and RAG Assistant
- **Frontend:** EJS Templates, Tailwind CSS, Chart.js
- **DevOps:** Docker & Docker Compose

---

## 🚀 Getting Started (Docker)

### 1. Prerequisites

- [Docker & Docker Compose](https://docker.com)
- A **Google Gemini API Key**

### 2. Environment Setup

Create a `.env` file in the project root:

```env
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/inventory_db
GEMINI_API_KEY=your_gemini_api_key_here
```

### 3. Start the Application

Launch both the Node.js server and PostgreSQL `pgvector` database:

```bash
docker-compose up
```

_(Or `docker compose up` if using Docker Compose V2)._

Open **`http://localhost:3000`** in your browser.

---

## 🧠 Vector Database Maintenance

### Create HNSW Vector Index

```bash
docker-compose exec postgres psql -U postgres -d inventory_db -c "
CREATE INDEX IF NOT EXISTS items_embedding_hnsw_idx
ON items
USING hnsw (embedding vector_cosine_ops);
"
```

### Backfill Embeddings for Existing Items

If items are seeded or imported directly via SQL without embeddings, run the built-in backfill script:

```bash
docker-compose exec app npm run backfill
```

---

## 📂 Project Structure

```text
inventory-app/
├── controllers/         # Request handlers (items, categories, RAG chatbot, restock advisor)
├── db/                  # PostgreSQL connection pool (db/pool.js)
├── models/              # SQL & pgvector queries (semantic search, RAG, similar items)
├── routes/              # Express routers
├── scripts/             # CLI utilities (backfillEmbeddings.js)
├── services/            # Gemini AI & PDF generation services
├── views/               # EJS templates & partials (dashboard, forms, chatbot, 404)
├── app.js               # Express entry point
├── Dockerfile
└── docker-compose.yml
```
