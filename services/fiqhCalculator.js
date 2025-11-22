const pool = require("../db");

// --- UTILITY FUNCTIONS FOR EXACT FRACTION ARITHMETIC (No changes here) ---

/**
 * Calculates the Greatest Common Divisor (GCD) of two numbers.
 * Used for simplifying fractions and finding common denominators.
 * @param {number} a
 * @param {number} b
 * @returns {number} GCD
 */
function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

/**
 * Converts a decimal representation of a key Islamic fraction (1/2, 1/4, 2/3, etc.)
 * to its exact numerator and denominator.
 * @param {number} decimalShare - The decimal value (e.g., 0.25, 0.6666...)
 * @returns {{num: number, den: number}} Exact fraction representation
 */
function toFraction(decimalShare) {
  if (decimalShare === null || isNaN(decimalShare)) return { num: 0, den: 1 };

  // Check common Fara'id shares
  if (Math.abs(decimalShare - 0.5) < 1e-9) return { num: 1, den: 2 }; // 1/2
  if (Math.abs(decimalShare - 0.25) < 1e-9) return { num: 1, den: 4 }; // 1/4
  if (Math.abs(decimalShare - 0.125) < 1e-9) return { num: 1, den: 8 }; // 1/8
  if (Math.abs(decimalShare - 2 / 3) < 1e-9) return { num: 2, den: 3 }; // 2/3
  if (Math.abs(decimalShare - 1 / 6) < 1e-9) return { num: 1, den: 6 }; // 1/6
  if (Math.abs(decimalShare - 1 / 3) < 1e-9) return { num: 1, den: 3 }; // 1/3

  const tolerance = 1e-6;
  if (Math.abs(decimalShare) < tolerance) return { num: 0, den: 1 };
  if (Math.abs(decimalShare - 1.0) < tolerance) return { num: 1, den: 1 };

  // Fallback for calculated/non-standard fractions
  let num = Math.round(decimalShare / tolerance);
  let den = Math.round(1 / tolerance);
  const commonDivisor = gcd(num, den);
  return { num: num / commonDivisor, den: den / commonDivisor };
}

/**
 * Adds two fractions (f1 + f2) and returns the simplified result.
 * @param {{num: number, den: number}} f1
 * @param {{num: number, den: number}} f2
 * @returns {{num: number, den: number}} Sum in simplified form
 */
function addFractions(f1, f2) {
  if (f1.num === 0) return f2;
  if (f2.num === 0) return f1;

  const newNum = f1.num * f2.den + f2.num * f1.den;
  const newDen = f1.den * f2.den;
  const commonDivisor = gcd(newNum, newDen);
  return { num: newNum / commonDivisor, den: newDen / commonDivisor };
}

/**
 * Subtracts two fractions (f1 - f2) and returns the simplified result.
 * @param {{num: number, den: number}} f1
 * @param {{num: number, den: number}} f2
 * @returns {{num: number, den: number}} Difference in simplified form
 */
function subtractFractions(f1, f2) {
  if (f2.num === 0) return f1;

  const newNum = f1.num * f2.den - f2.num * f1.den;
  const newDen = f1.den * f2.den;
  if (newNum < 0) return { num: 0, den: 1 };

  const commonDivisor = gcd(newNum, newDen);
  return { num: newNum / commonDivisor, den: newDen / commonDivisor };
}

/**
 * Divides a fraction (f1 / f2) and returns the simplified result.
 * @param {{num: number, den: number}} f1
 * @param {{num: number, den: number}} f2
 * @returns {{num: number, den: number}} Quotient in simplified form
 */
function divideFractions(f1, f2) {
  if (f2.num === 0 || f1.num === 0) return { num: 0, den: 1 };

  const newNum = f1.num * f2.den;
  const newDen = f1.den * f2.num;
  const commonDivisor = gcd(newNum, newDen);
  return { num: newNum / commonDivisor, den: newDen / commonDivisor };
}

/**
 * Multiplies two fractions (f1 * f2) and returns the simplified result.
 * @param {{num: number, den: number}} f1
 * @param {{num: number, den: number}} f2
 * @returns {{num: number, den: number}} Product in simplified form
 */
function multiplyFractions(f1, f2) {
  const newNum = f1.num * f2.num;
  const newDen = f1.den * f2.den;
  const commonDivisor = gcd(newNum, newDen);
  return { num: newNum / commonDivisor, den: newDen / commonDivisor };
}

/**
 * Converts a fraction object to a decimal number.
 * @param {{num: number, den: number}} f
 * @returns {number}
 */
function toDecimal(f) {
  if (f && f.den > 0) {
    return f.num / f.den;
  }
  return 0;
}

// --- END UTILITY FUNCTIONS ---

/**
 * Main function to calculate inheritance shares according to Fiqh principles.
 * @param {object} input - Contains deceased, assets, liabilities, and heirs list.
 * @returns {object} - The final calculation result.
 */
exports.calculateShares = async (input) => {
  const { deceased, assets, liabilities, heirs } = input;

  // Basic Estate Calculation
  const netEstate = assets - liabilities;

  let heirsWithDetails = [];
  let allRules = [];

  try {
    // 1. Retrieve Heir Details (Classification and Default Share)
    const heirDetailsQuery = `
            SELECT heir_type_id, name_en, classification, default_share 
            FROM HeirTypes 
            WHERE name_en = ANY($1::text[])
        `;
    const detailsResult = await pool.query(heirDetailsQuery, [
      heirs.map((h) => h.name),
    ]);
    const detailsMap = new Map(detailsResult.rows.map((d) => [d.name_en, d]));

    // 2. Map frontend heirs with database details
    heirsWithDetails = heirs.map((h) => ({
      ...h,
      // The frontend name (h.name) must match a key in detailsMap (d.name_en).
      ...detailsMap.get(h.name),
      isExcluded: false,
      // Initialize shares as fractions
      finalShareFraction: { num: 0, den: 1 },
      status: "PENDING",
    }));

    // 3. Retrieve Fiqh Rules (Exclusion and Reduction)
    const heirNames = heirs.map((h) => h.name);
    const ruleQuery = `
            SELECT 
                t1.name_en AS primary_heir_name,
                t2.name_en AS condition_heir_name,
                r.condition_type,
                r.reduction_factor
            FROM FiqhRules r
            JOIN HeirTypes t1 ON r.heir_type_id = t1.heir_type_id
            LEFT JOIN HeirTypes t2 ON r.condition_heir_id = t2.heir_type_id
            WHERE t1.name_en = ANY($1::text[]) OR t2.name_en = ANY($1::text[]);
        `;
    const ruleResult = await pool.query(ruleQuery, [heirNames]);
    allRules = ruleResult.rows;
  } catch (error) {
    console.error("Database query for Fiqh Rules failed:", error);
    throw new Error(
      "Failed to retrieve inheritance rules from the database. Check database connection and migrations."
    );
  }

  // --- START FARA'ID LOGIC IMPLEMENTATION ---

  // 1. Apply Exclusion (Hajb) Rules (Same as before)
  allRules
    .filter((r) => r.condition_type === "Exclusion")
    .forEach((rule) => {
      const isConditionPresent = heirsWithDetails.some(
        (h) => h.name_en === rule.condition_heir_name && h.count > 0
      );

      if (isConditionPresent) {
        const excludedIndex = heirsWithDetails.findIndex(
          (h) => h.name_en === rule.primary_heir_name
        );
        if (excludedIndex !== -1) {
          heirsWithDetails[excludedIndex].isExcluded = true;
          heirsWithDetails[excludedIndex].status =
            "EXCLUDED by " + rule.condition_heir_name;
        }
      }
    });

  let survivingHeirs = heirsWithDetails.filter((h) => !h.isExcluded);

  // Determine if any descendant is present
  const descendantIsPresent = survivingHeirs.some(
    (h) => h.name_en === "Son" || h.name_en === "Daughter"
  );

  // Check if a Son is present (to switch Daughter to Asaba)
  const sonIsPresent = survivingHeirs.some((h) => h.name_en === "Son");

  // === DYNAMIC SHARE ADJUSTMENTS BASED ON PRESENCE AND COUNT ===

  survivingHeirs = survivingHeirs.map((heir) => {
    let updatedHeir = { ...heir };
    let newDecimalShare = updatedHeir.default_share;

    // 2. Spouse Share Reduction (Presence of Descendants)
    if (updatedHeir.name_en === "Husband") {
      newDecimalShare = descendantIsPresent ? 0.25 : 0.5;
      updatedHeir.status = `FARAD: Allocated ${newDecimalShare} (Descendants: ${
        descendantIsPresent ? "Yes" : "No"
      })`;
    } else if (updatedHeir.name_en === "Wife") {
      newDecimalShare = descendantIsPresent ? 0.125 : 0.25;
      updatedHeir.status = `FARAD: Allocated ${newDecimalShare} (Descendants: ${
        descendantIsPresent ? "Yes" : "No"
      })`;
    }

    // 3. Daughter Fixed Share based on Count (ONLY if no Son is present)
    if (updatedHeir.name_en === "Daughter" && !sonIsPresent) {
      if (updatedHeir.count >= 2) {
        newDecimalShare = 2 / 3; // Collective share to 2/3
        updatedHeir.status = "FARAD: Allocated 2/3 (Multiple Daughters)";
      } else if (updatedHeir.count === 1) {
        newDecimalShare = 0.5; // Share to 1/2
        updatedHeir.status = "FARAD: Allocated 1/2 (Single Daughter)";
      }
    }

    // Update the heir's share with the new decimal value for Step 6/7/8
    updatedHeir.default_share = newDecimalShare;

    // 4. Asaba bi-ghayrihi (Daughter with Son) Rule
    if (updatedHeir.name_en === "Daughter" && sonIsPresent) {
      updatedHeir.classification = "Asaba";
      updatedHeir.default_share = null;
      updatedHeir.status = "ASABA (with Son)";
    }

    // 5. Father as pure Asaba Rule
    if (updatedHeir.name_en === "Father" && !descendantIsPresent) {
      updatedHeir.classification = "Asaba";
      updatedHeir.default_share = null;
      updatedHeir.status = "ASABA (No Descendants)";
    }

    return updatedHeir;
  });

  // 6. Apply Fixed Share (As-hab al-Faraid) Rules using Fractions
  let totalFaraidShareFraction = { num: 0, den: 1 };

  survivingHeirs = survivingHeirs.map((heir) => {
    if (
      heir.classification !== "As-hab al-Faraid" ||
      heir.default_share === null
    ) {
      return heir; // Skip non-Faraid heirs or those set to null share (like Asaba father)
    }

    let updatedHeir = { ...heir };
    let finalShareFraction = toFraction(updatedHeir.default_share);

    // Apply Reduction Rules (from database, if any)
    const reductionRules = allRules.filter(
      (r) =>
        r.condition_type === "Reduction" && r.primary_heir_name === heir.name_en
    );

    reductionRules.forEach((rule) => {
      const isConditionPresent = survivingHeirs.some(
        (h) => h.name_en === rule.condition_heir_name && h.count > 0
      );

      if (isConditionPresent && rule.reduction_factor !== null) {
        finalShareFraction = toFraction(rule.reduction_factor);
        updatedHeir.status = `FARAD: Reduced to ${rule.reduction_factor} by ${rule.condition_heir_name}`;
      }
    });

    if (finalShareFraction.num > 0) {
      // MANDATORY STEP: Set the exact fraction for all Faraid heirs.
      updatedHeir.finalShareFraction = finalShareFraction;

      // Calculate total Faraid share based on the collective share for the group
      totalFaraidShareFraction = addFractions(
        totalFaraidShareFraction,
        updatedHeir.finalShareFraction
      );

      updatedHeir.status = updatedHeir.status.startsWith("FARAD")
        ? updatedHeir.status
        : `FARAD: Allocated ${toDecimal(finalShareFraction).toFixed(4)} (${
            finalShareFraction.num
          }/${finalShareFraction.den})`;
    }
    return updatedHeir;
  });

  // LOGGING: Check Husband's share before Reconciliation
  const husband = survivingHeirs.find((h) => h.name_en === "Husband");
  if (husband) {
    console.log(
      `[DEBUG] Husband's share before Radd/Awl: ${husband.finalShareFraction.num}/${husband.finalShareFraction.den}`
    );
  }

  // 7. Apply Residue (Asaba) Rules
  const oneWhole = { num: 1, den: 1 };
  let residueFraction = subtractFractions(oneWhole, totalFaraidShareFraction);
  let asabaHeirs = survivingHeirs.filter((h) => h.classification === "Asaba");

  // Convert residueFraction to decimal for proportional Asaba calculation (simpler)
  let residueDecimal = toDecimal(residueFraction);

  if (residueDecimal > 1e-9 && asabaHeirs.length > 0) {
    let totalAsabaPoints = 0;

    survivingHeirs = survivingHeirs.map((heir) => {
      if (heir.classification !== "Asaba") return heir;

      let updatedHeir = { ...heir };
      let points = 0;

      // Assign points for 2:1 male:female ratio
      if (
        heir.name_en &&
        (heir.name_en.includes("Son") ||
          heir.name_en.includes("Brother") ||
          heir.name_en === "Father")
      ) {
        points = heir.count * 2;
      } else if (
        heir.name_en &&
        (heir.name_en.includes("Daughter") || heir.name_en.includes("Sister"))
      ) {
        points = heir.count * 1;
      } else {
        points = 0;
      }

      updatedHeir.points = points;
      totalAsabaPoints += points;
      return updatedHeir;
    });

    if (totalAsabaPoints > 0) {
      survivingHeirs = survivingHeirs.map((heir) => {
        if (heir.classification !== "Asaba" || heir.points === 0) return heir;

        let updatedHeir = { ...heir };
        // Calculate the Asaba share using decimals for proportion and convert back to fraction
        const asabaShareDecimal =
          residueDecimal * (updatedHeir.points / totalAsabaPoints);

        // Convert to a fraction
        const asabaShareFraction = toFraction(asabaShareDecimal);

        updatedHeir.finalShareFraction = addFractions(
          updatedHeir.finalShareFraction,
          asabaShareFraction
        );

        updatedHeir.status = updatedHeir.status.includes("ASABA")
          ? updatedHeir.status +
            ` (Allocated Residue of ${asabaShareDecimal.toFixed(4)})`
          : `ASABA: Allocated Residue of ${asabaShareDecimal.toFixed(4)}`;
        updatedHeir.classification = "Asaba (Residue)";
        return updatedHeir;
      });
    }
  }

  // 8. Reconciliation (Awl and Radd)

  // Recalculate total share BEFORE RADD/AWL for accurate check
  totalFinalShareFraction = survivingHeirs.reduce(
    (sumFraction, h) => addFractions(sumFraction, h.finalShareFraction),
    { num: 0, den: 1 }
  );
  let totalFinalShareDecimal = toDecimal(totalFinalShareFraction);

  const hasAsaba = survivingHeirs.some(
    (h) => h.classification && h.classification.includes("Asaba")
  );
  let reconciliationStatus = "Balanced";

  // Awl (Increase): Total Faraid share exceeds 1.0
  if (totalFinalShareDecimal > 1.0001) {
    reconciliationStatus = "Awl (Increase)";

    // Awl factor is the total fraction itself
    const awlFactor = totalFinalShareFraction;

    survivingHeirs = survivingHeirs.map((heir) => {
      let updatedHeir = { ...heir };
      // Deep clone the share fraction for safety before mutation
      updatedHeir.finalShareFraction = { ...heir.finalShareFraction };

      if (updatedHeir.finalShareFraction.num > 0) {
        // New Share = Old Share / Awl Factor
        updatedHeir.finalShareFraction = divideFractions(
          updatedHeir.finalShareFraction,
          awlFactor
        );
      }
      return updatedHeir;
    });
    totalFinalShareFraction = oneWhole;
    totalFinalShareDecimal = 1.0;
  }

  // Radd (Return): Residue remains and there is no Asaba heir
  if (totalFinalShareDecimal < 0.9999 && !hasAsaba) {
    reconciliationStatus = "Radd (Return)";

    // Spouses must be excluded from receiving Radd
    const spouseHeirs = survivingHeirs.filter(
      (h) => h.name_en === "Husband" || h.name_en === "Wife"
    );

    // Use the *current* fixed share of the spouse(s) for the pool calculation.
    const spouseShareSumFraction = spouseHeirs.reduce(
      (sum, h) => addFractions(sum, h.finalShareFraction),
      { num: 0, den: 1 }
    );

    // The fraction available for redistribution is 1 - Spouse Share Sum (e.g., 1 - 1/4 = 3/4)
    const raddPoolFraction = subtractFractions(
      oneWhole,
      spouseShareSumFraction
    );

    // Radd-eligible heirs (non-spouse Faraid heirs with a share)
    const raddHeirs = survivingHeirs.filter(
      (h) =>
        h.classification === "As-hab al-Faraid" &&
        h.finalShareFraction.num > 0 &&
        !h.name_en.includes("Wife") &&
        !h.name_en.includes("Husband")
    );

    // Calculate the sum of shares *eligible for Radd* (e.g., Daughters' 2/3 share)
    const sumOfEligibleSharesFraction = raddHeirs.reduce(
      (sum, h) => addFractions(sum, h.finalShareFraction),
      { num: 0, den: 1 }
    );

    // LOGGING: Check Radd Calculation values
    console.log(
      `[DEBUG] Radd Init: Spouse Share Sum: ${spouseShareSumFraction.num}/${spouseShareSumFraction.den}. Radd Pool: ${raddPoolFraction.num}/${raddPoolFraction.den}. Eligible Sum: ${sumOfEligibleSharesFraction.num}/${sumOfEligibleSharesFraction.den}`
    );

    if (sumOfEligibleSharesFraction.num > 0) {
      survivingHeirs = survivingHeirs.map((heir) => {
        let updatedHeir = { ...heir };

        // CRITICAL FIX: Ensure the share object is deep-cloned before any Radd-related logic
        updatedHeir.finalShareFraction = { ...heir.finalShareFraction };

        // Check if this heir is eligible for Radd
        const isRaddEligible = raddHeirs.some(
          (r) => r.name_en === updatedHeir.name_en
        );

        // Spouses' shares are FIXED, Radd-eligible heirs' shares are RECALCULATED based on the Radd Pool.
        if (isRaddEligible) {
          // The proportion based on their initial share: Proportion = (Heir Share / Sum of Eligible Shares)
          const proportionFraction = divideFractions(
            updatedHeir.finalShareFraction,
            sumOfEligibleSharesFraction
          );

          // The new total share for the Radd-eligible heir is: Radd Pool * Proportion
          updatedHeir.finalShareFraction = multiplyFractions(
            raddPoolFraction,
            proportionFraction
          );

          updatedHeir.status += ` (Radd applied: New share ${updatedHeir.finalShareFraction.num}/${updatedHeir.finalShareFraction.den})`;
        } else if (spouseHeirs.some((s) => s.name_en === updatedHeir.name_en)) {
          // Spouse's share is maintained (already preserved via deep clone)
          // This line is for clarity and debugging, ensuring the value is what we expect.
          updatedHeir.status += ` (Spouse: Share maintained at ${updatedHeir.finalShareFraction.num}/${updatedHeir.finalShareFraction.den})`;
        }
        // If the heir is not eligible for Radd or a spouse, the initial deep-cloned fraction is returned as is.
        return updatedHeir;
      });
    }
    totalFinalShareFraction = oneWhole;
    totalFinalShareDecimal = 1.0;
  }

  // 9. Final Output
  return {
    netEstate: netEstate,
    totalFractionAllocated: totalFinalShareDecimal,
    reconciliation: reconciliationStatus,
    shares: survivingHeirs.map((h) => {
      // Convert the final exact fraction to a decimal for display
      const finalShareDecimal = toDecimal(h.finalShareFraction);

      return {
        heir: h.name_en,
        count: h.count,
        classification: h.classification,
        // Share fraction of total is the group's total claim on the estate
        share_fraction_of_total: finalShareDecimal,
        share_amount: finalShareDecimal * netEstate,
        status: h.status,
      };
    }),
    notes: `Calculation finished. Reconciliation status: ${reconciliationStatus}. Total Final Fraction: ${totalFinalShareFraction.num}/${totalFinalShareFraction.den}`,
  };
};
