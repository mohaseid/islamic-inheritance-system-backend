const fiqhCalculator = require("../services/fiqhCalculator");

/**
 * @swagger
 * paths:
 * /api/calculate-shares:
 * post:
 * tags:
 * - Calculation
 * summary: Calculates the final Islamic inheritance shares.
 * description: Takes estate details and a list of surviving heirs, and returns the calculated fractional and monetary shares based on Fiqh al-Mawārīth.
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
 * description: The gender of the deceased.
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
 * example: Wife
 * description: The Fiqh classification name of the heir (e.g., Son, Daughter, Wife, Father).
 * count:
 * type: integer
 * example: 1
 * description: The number of individuals of this heir type.
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
 * share_fraction_of_total:
 * type: number
 * example: 0.166667
 * status:
 * type: string
 * example: FARAD: Allocated 0.166667
 * '400':
 * description: Invalid input provided (e.g., missing heirs).
 * content:
 * application/json:
 * schema:
 * type: object
 * properties:
 * error:
 * type: string
 * example: No heirs provided for calculation.
 * '500':
 * description: Server error during calculation.
 * content:
 * application/json:
 * schema:
 * type: object
 * properties:
 * error:
 * type: string
 * example: An internal error occurred during the Fiqh calculation process.
 */
exports.calculateShares = async (req, res) => {
  // The request body contains all the necessary input data
  const input = req.body;

  // --- Input Validation ---

  // 1. Check for heirs list presence and contents
  if (!input.heirs || input.heirs.length === 0) {
    return res
      .status(400)
      .json({ error: "No heirs provided for calculation." });
  }

  // 2. Check for required financial fields
  // Using loose comparison for 'undefined' to check if the property exists
  if (input.assets === undefined || input.liabilities === undefined) {
    return res
      .status(400)
      .json({ error: "Assets and liabilities must be defined." });
  }

  // 3. Ensure assets and liabilities are non-negative numbers
  if (
    typeof input.assets !== "number" ||
    input.assets < 0 ||
    typeof input.liabilities !== "number" ||
    input.liabilities < 0
  ) {
    return res
      .status(400)
      .json({ error: "Assets and liabilities must be non-negative numbers." });
  }

  // 4. Ensure deceased gender is provided
  if (
    !input.deceased ||
    (input.deceased !== "male" && input.deceased !== "female")
  ) {
    return res
      .status(400)
      .json({ error: "Deceased gender (male/female) must be specified." });
  }

  // --- Fiqh Calculation ---
  try {
    // Pass the validated input data to the specialized service layer for calculation
    const calculationResult = await fiqhCalculator.calculateShares(input);

    // Send the successful result back to the client
    return res.status(200).json(calculationResult);
  } catch (error) {
    // Handle any errors that occur during the calculation service logic
    console.error("Full Calculation Error:", error);

    // Return a 500 status with a descriptive error message
    return res.status(500).json({
      error:
        error.message ||
        "An internal error occurred during the Fiqh calculation process.",
    });
  }
};
