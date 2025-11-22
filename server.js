const express = require("express");
const cors = require("cors");

const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
require("dotenv").config();

const calculateController = require("./controllers/calculateController");

const app = express();

const PORT = process.env.PORT || 3001;

app.use(
  cors({ origin: "https://islamic-inheritance-system-frontend.vercel.app" })
);

app.use(express.json());

const swaggerSpec = YAML.load("./openapi.yaml");

swaggerSpec.servers[0].url = `http://localhost:${PORT}/api/`;

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
console.log(
  `Swagger documentation available at http://localhost:${PORT}/api-docs`
);

app.post("/api/calculate-shares", calculateController.calculateShares);

app.get("/", (req, res) => {
  res.send(
    "Islamic Inheritance System API is running. Access documentation at /api-docs"
  );
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
