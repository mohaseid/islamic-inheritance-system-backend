const express = require("express");
const cors = require("cors");

require("dotenv").config();

const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");

const app = express();

const port = process.env.PORT || 3001;

app.use(
  cors({
    origin: "*",
  })
);

app.use(express.json());

const calculateController = require("./controllers/calculateController");

/**
 * @swagger
 * /api/calculate:
 * post:
 * tags:
 * - Calculation
 * summary: Calculates the final Islamic inheritance shares.
 * description: Takes estate details and a list of surviving heirs, and returns the calculated fractional and monetary shares.
 * requestBody:
 * required: true
 * content:
 * application/json:
 * schema:
 * type: object
 * required:
 * - deceased
 * - assets
 * - liabilities
 * - heirs
 * properties:
 * deceased:
 * type: string
 * enum: [male, female]
 * example: male
 * assets:
 * type: number
 * description: Total value of the estate before liabilities and shares.
 * example: 100000
 * liabilities:
 * type: number
 * description: Total debts, funeral expenses, and bequests (up to 1/3).
 * example: 5000
 * heirs:
 * type: array
 * items:
 * type: object
 * properties:
 * name:
 * type: string
 * example: Spouse (Wife)
 * count:
 * type: integer
 * example: 1
 * responses:
 * '200':
 * description: Successfully calculated shares.
 * content:
 * application/json:
 * schema:
 * type: object
 * properties:
 * netEstate:
 * type: number
 * example: 95000
 * reconciliation:
 * type: string
 * example: Balanced
 * shares:
 * type: array
 * items:
 * type: object
 * properties:
 * heir:
 * type: string
 * example: Mother
 * share_amount:
 * type: number
 * example: 15833.33
 * '400':
 * description: Invalid input provided.
 * '500':
 * description: Server error.
 */
app.post("/api/calculate", calculateController.calculateShares);

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
        url: `http://localhost:${port}`,
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

  apis: ["./controllers/*.js", "./server.js"],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get("/", (req, res) => {
  res.send(
    "Islamic Inheritance System API is running. Access documentation at /api-docs"
  );
});

app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
