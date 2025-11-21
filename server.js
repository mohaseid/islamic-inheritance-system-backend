const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3001;

app.use(
  cors({
    origin: "http://localhost:5173",
  })
);

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Islamic Inheritance System Backend API is running!");
});

const calculateController = require("./controllers/calculateController");

app.post("/api/calculate", calculateController.calculateShares);

app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
