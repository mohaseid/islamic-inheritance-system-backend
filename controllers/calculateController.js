const fiqhCalculator = require("../services/fiqhCalculator");

/**
 * @swagger
 * tags:
 * name: Calculation
 * description: Core inheritance share calculation operations
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
 * description: Invalid input provided (e.g., missing heirs).
 * '500':
 * description: Server error during calculation.
 * /api/calculate: // NOTE: If this path is duplicated from the swaggerDefinition in server.js, remove this line.
 * post:
 *
 */
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
    console.error("Full Calculation Error:", error);
    return res.status(500).json({
      error:
        error.message ||
        "An internal error occurred during the Fiqh calculation process.",
    });
  }
};
