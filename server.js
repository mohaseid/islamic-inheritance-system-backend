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
  },

  apis: ["./controllers/*.js"],
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
