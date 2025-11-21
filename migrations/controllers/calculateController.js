const pool = require("../db");

exports.calculateShares = async (req, res) => {
  const { deceased, assets, liabilities, heirs } = req.body;

  if (!heirs || heirs.length === 0) {
    return res
      .status(400)
      .json({ error: "No heirs provided for calculation." });
  }

  try {
    const netEstate = assets - liabilities;

    const calculationResult = {
      netEstate: netEstate,
      shares: [
        {
          heir: "Spouse (Wife)",
          share_fraction: "1/8",
          share_amount: netEstate / 8,
        },
        { heir: "Mother", share_fraction: "1/6", share_amount: netEstate / 6 },
      ],
      notes:
        "Calculation based on initial Fiqh rules data. Full logic implementation is pending.",
    };

    return res.status(200).json(calculationResult);
  } catch (error) {
    console.error("Calculation Error:", error);
    return res
      .status(500)
      .json({ error: "An error occurred during the calculation process." });
  }
};
