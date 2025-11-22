const { Pool } = require("pg");
require("dotenv").config();

let poolConfig = {
  // Default configuration using individual environment variables
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
};

// Override with connectionString if DATABASE_URL is provided (Standard for Render/Heroku)
if (process.env.DATABASE_URL) {
  poolConfig = {
    connectionString: process.env.DATABASE_URL,
    // CRITICAL: Required for secure connections to remote PostgreSQL instances (like Render's)
    ssl: {
      rejectUnauthorized: false,
    },
  };
} else if (!process.env.DB_HOST) {
  // If neither full URL nor individual host is set, log a critical warning
  console.warn(
    "⚠️ WARNING: No database configuration found (neither DATABASE_URL nor individual DB variables)."
  );
}

const pool = new Pool(poolConfig);

// Add event listeners for connection monitoring
// This logs the status automatically when the server starts.
pool.on("connect", () => {
  console.log("✅ PostgreSQL client connected successfully.");
});

pool.on("error", (err) => {
  // Logs unexpected errors that happen during database operation
  console.error("🔥 Unexpected error on idle PostgreSQL client", err.message);
});

// Export the pool instance
module.exports = pool;
