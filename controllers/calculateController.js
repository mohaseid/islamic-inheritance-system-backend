const fiqhCalculator = require("../services/fiqhCalculator");

exports.calculateShares = async (req, res) => {
  const input = req.body;

  if (!input.heirs || input.heirs.length === 0) {
    return res
      .status(400)
      .json({ error: "No heirs provided for calculation." });
  }

  try {
    const calculationResult = await fiqhCalculator.calculateShares(input);

    return res.status(200).json(calculationResult);
  } catch (error) {
    console.error("Calculation Error:", error);
    return res.status(500).json({
      error:
        error.message || "An error occurred during the calculation process.",
    });
  }
};
