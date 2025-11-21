const pool = require("./db");
const fs = require("fs");
const path = require("path");

async function runMigrations() {
  const migrationPath = path.join(
    __dirname,
    "migrations",
    "001_create_initial_tables.sql"
  );
  const sql = fs.readFileSync(migrationPath, { encoding: "utf-8" });

  try {
    await pool.query(sql);
    console.log("✅ Initial database tables created successfully!");
  } catch (err) {
    console.error("❌ Error running migration:", err.message);
  } finally {
    pool.end();
  }
}

runMigrations();
