const express = require("express");
const cors = require("cors");
const { setupDatabase } = require("./db"); // Ensures database is initialized and ready

const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
// Load environment variables from .env file
require("dotenv").config();

// Assuming you have this controller defined for the business logic
const calculateController = require("./controllers/calculateController");

const app = express();

// Use the PORT defined in the environment variables, or 3001 as a default
const PORT = process.env.PORT || 3001;

// --- Middleware Setup ---
// 1. CORS: Allows the frontend application to make requests to this API
app.use(
  cors({ origin: "https://islamic-inheritance-system-frontend.vercel.app" })
);
// 2. JSON Body Parser: Parses incoming JSON request bodies
app.use(express.json());

// --- Documentation Setup (Swagger/OpenAPI) ---
// Load the OpenAPI spec from the YAML file
const swaggerSpec = YAML.load("./openapi.yaml");

// Update the server URL dynamically to match the expected deployed endpoint
// This helps ensure the documentation reflects the correct live API URL.
swaggerSpec.servers[0].url = `https://islamic-inheritance-system-backend-1.onrender.com/api`;

// Serve the documentation using swagger-ui-express
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
console.log(
  `Swagger documentation available at https://islamic-inheritance-system-backend-1.onrender.com/api-docs`
);

// --- API Routes ---
// The main endpoint for calculating inheritance shares
app.post("/api/calculate-shares", calculateController.calculateShares);

// Simple root endpoint to confirm the API is running
app.get("/", (req, res) => {
  res.send(
    "Islamic Inheritance System API is running. Access documentation at /api-docs"
  );
});

// --- Asynchronous Server Startup Sequence ---
// This function ensures the critical database connection and setup is complete
// before the Express server starts listening for web requests.
async function startServer() {
  try {
    console.log("Attempting database setup...");

    // Wait for the database connection and initial Fiqh data to be loaded.
    // This is crucial for stability.
    await setupDatabase();
    console.log("✅ Database initialized successfully.");

    // Start the server only after DB setup is successful
    app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
    });
  } catch (error) {
    // If the database setup fails, log the error and stop the process
    // because the application cannot function without the DB.
    console.error(
      "FATAL ERROR: Failed to start server due to critical database issue.",
      error.stack
    );
    // Exiting with code 1 signals an unrecoverable error
    process.exit(1);
  }
}

// Initiate the server startup process
startServer();
