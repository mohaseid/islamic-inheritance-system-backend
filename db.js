const { Pool } = require("pg");
require("dotenv").config();

let poolConfig = {
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
};

if (process.env.DATABASE_URL) {
  poolConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  };
}

const pool = new Pool(poolConfig);

async function checkConnection() {
  try {
    await pool.query("SELECT 1");
    console.log("✅ PostgreSQL connection successful.");
  } catch (error) {
    console.error("❌ Error connecting to PostgreSQL:", error.message);
  }
}

module.exports = pool;
