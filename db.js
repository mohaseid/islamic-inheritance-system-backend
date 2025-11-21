const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

async function checkConnection() {
  try {
    await pool.query("SELECT 1");
    console.log("✅ PostgreSQL connection successful.");
  } catch (error) {
    console.error("❌ Error connecting to PostgreSQL:", error.message);
  }
}

module.exports = pool;
