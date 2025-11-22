const express = require("express");
const cors = require("cors");

const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");
require("dotenv").config();

const calculateController = require("./controllers/calculateController");

const app = express();
// Using PORT 3001 as defined in your provided code block, or 10000 as a fallback
const PORT = process.env.PORT || 3001;

// --- Middleware ---
app.use(cors({ origin: "*" }));
// Use express's built-in JSON parser (replaces body-parser)
app.use(express.json());

// --- Swagger Documentation Setup (Using JSDoc) ---

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Islamic Inheritance System API",
      version: "1.0.0",
      description:
        "The backend engine for calculating Fiqh al-Mawārīth shares.",
    },
    servers: [
      {
        url: `http://localhost:${PORT}`,
        description: "Local Development Server",
      },
      {
        url: "https://moha-inheritance-api.onrender.com",
        description: "Production Render API",
      },
    ],
    tags: [
      {
        name: "Calculation",
        description: "Core inheritance share calculation operations",
      },
    ],
  },
  // This tells swagger-jsdoc to look in the controller files for the route documentation
  apis: ["./controllers/*.js"],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// Endpoint for the interactive documentation UI
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
console.log(
  `Swagger documentation available at http://localhost:${PORT}/api-docs`
);

// --- API Route ---
// This route is documented via JSDoc in controllers/calculateController.js
app.post("/api/calculate", calculateController.calculateShares);

// --- Default Root Route ---
app.get("/", (req, res) => {
  res.send(
    `Islamic Inheritance System API is running. Access documentation at /api-docs`
  );
});

// --- Server Start ---
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
