const pool = require("./db");
const fs = require("fs");
const path = require("path");

const migrationFiles = [
  "001_create_initial_tables.sql",
  "002_insert_fiqh_data.sql",
];

async function runMigrations() {
  console.log("Starting full database migration sequence...");
  let success = true;

  try {
    for (const file of migrationFiles) {
      const migrationPath = path.join(__dirname, "migrations", file);
      const sql = fs.readFileSync(migrationPath, { encoding: "utf-8" });

      console.log(`-> Running migration: ${file}`);
      await pool.query(sql);
      console.log(`✅ ${file} completed.`);
    }
    console.log("✅ All migrations finished successfully!");
  } catch (err) {
    console.error("❌ A migration failed:", err.message);
    success = false;
  } finally {
    if (success) {
      console.log("Database connection closed.");
    } else {
      console.error("Database connection closed after failure.");
    }
    pool.end();
  }
}

runMigrations();
