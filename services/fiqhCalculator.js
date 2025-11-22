const pool = require("../db");

// --- UTILITY FUNCTIONS FOR EXACT FRACTION ARITHMETIC (Corrected 1/8) ---

/**
 * Calculates the Greatest Common Divisor (GCD) of two numbers.
 * Used for simplifying fractions and finding common denominators.
 * @param {number} a
 * @returns {number} GCD
 * @param {number} b
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
  // FIXED: Corrected 1/8 fraction mapping
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

    // Update the heir's share with the new decimal value for Step 6
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
    let updatedHeir = { ...heir };
    const isSpouse =
      updatedHeir.name_en === "Husband" || updatedHeir.name_en === "Wife";

    // Ensure fixed share is allocated if it's Faraid OR a Spouse, AND a share exists
    if (
      (updatedHeir.classification === "As-hab al-Faraid" || isSpouse) &&
      updatedHeir.default_share !== null
    ) {
      let finalShareFraction = toFraction(updatedHeir.default_share);

      // Apply Reduction Rules (from database, if any)
      const reductionRules = allRules.filter(
        (r) =>
          r.condition_type === "Reduction" &&
          r.primary_heir_name === heir.name_en
      );

      reductionRules.forEach((rule) => {
        const isConditionPresent = survivingHeirs.some(
          (h) => h.name_en === rule.condition_heir_name && h.count > 0
        );

        if (isConditionPresent && rule.reduction_factor !== null) {
          finalShareFraction = toFraction(rule.reduction_factor);
          updatedHeir.status = `FARAD: Reduced to ${finalShareFraction.num}/${finalShareFraction.den} by ${rule.condition_heir_name}`;
        }
      });

      if (finalShareFraction.num > 0) {
        // Set the exact fraction for all Faraid heirs.
        updatedHeir.finalShareFraction = finalShareFraction;

        // Calculate total Faraid share based on the collective share for the group
        totalFaraidShareFraction = addFractions(
          totalFaraidShareFraction,
          finalShareFraction
        );

        updatedHeir.status = updatedHeir.status.startsWith("FARAD")
          ? updatedHeir.status
          : `FARAD: Allocated ${finalShareFraction.num}/${finalShareFraction.den}`;
      }
    } else if (
      updatedHeir.classification &&
      updatedHeir.classification.includes("Asaba")
    ) {
      // Clear fixed share for Asaba heirs
      updatedHeir.finalShareFraction = { num: 0, den: 1 };
    }
    return updatedHeir;
  });

  // Calculate the total fixed share for all spouses after Step 6 processing
  const spouseHeirs = survivingHeirs.filter(
    (h) => h.name_en === "Husband" || h.name_en === "Wife"
  );
  let spouseFixedShareFractionSum = spouseHeirs.reduce(
    (sum, h) => addFractions(sum, h.finalShareFraction),
    { num: 0, den: 1 }
  );

  // 7. Apply Residue (Asaba) Rules
  const oneWhole = { num: 1, den: 1 };
  let residueFraction = subtractFractions(oneWhole, totalFaraidShareFraction);
  let residueDecimal = toDecimal(residueFraction);

  if (residueDecimal > 0.0001) {
    const asabaHeirs = survivingHeirs.filter(
      (h) => h.classification && h.classification.includes("Asaba")
    );

    if (asabaHeirs.length > 0) {
      // Calculate the relative weight of the Asaba group for distribution
      const totalAsabaWeight = asabaHeirs.reduce((sum, h) => {
        if (h.name_en === "Son" || (h.name_en === "Daughter" && sonIsPresent)) {
          return sum + (h.name_en === "Son" ? h.count * 2 : h.count * 1);
        }
        // Other Asaba heirs (like Father with no descendants)
        return sum + h.count;
      }, 0);

      survivingHeirs = survivingHeirs.map((heir) => {
        let updatedHeir = { ...heir };

        if (
          updatedHeir.classification &&
          updatedHeir.classification.includes("Asaba")
        ) {
          let weight = 0;

          if (
            updatedHeir.name_en === "Son" ||
            (updatedHeir.name_en === "Daughter" && sonIsPresent)
          ) {
            // Son gets 2 shares, Daughter gets 1 share (Bi-ghayrihi)
            weight =
              updatedHeir.name_en === "Son"
                ? updatedHeir.count * 2
                : updatedHeir.count * 1;
          } else if (updatedHeir.name_en === "Father" && !descendantIsPresent) {
            // Father as pure Asaba gets all residue
            weight = updatedHeir.count;
          }

          if (totalAsabaWeight > 0) {
            // Calculate the share fraction of the residue
            const heirFractionOfResidue = {
              num: weight,
              den: totalAsabaWeight,
            };

            // Multiply residue by the heir's proportion
            const finalResidueShare = multiplyFractions(
              residueFraction,
              heirFractionOfResidue
            );

            // Add the residue share to the heir's final share
            updatedHeir.finalShareFraction = addFractions(
              updatedHeir.finalShareFraction,
              finalResidueShare
            );
            updatedHeir.status = `ASABA: Received ${finalResidueShare.num}/${finalResidueShare.den} of the residue.`;
          }
        }
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

    const awlFactor = totalFinalShareFraction;

    survivingHeirs = survivingHeirs.map((heir) => {
      let updatedHeir = { ...heir };
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

    // --- NEW ROBUST RADD LOGIC ---

    // Special Case 1: Only one heir survives (Spouse or Non-Spouse Faraid)
    if (
      survivingHeirs.length === 1 &&
      survivingHeirs[0].finalShareFraction.num > 0
    ) {
      survivingHeirs[0].finalShareFraction = oneWhole;
      survivingHeirs[0].status += " (Radd applied: Takes full estate, 1/1)";
      totalFinalShareFraction = oneWhole;
      totalFinalShareDecimal = 1.0;
    } else {
      // Standard Radd: Multiple heirs, including spouse, and non-spouse Faraid heirs (Radd Eligible)

      // 1. The fraction available for redistribution is 1 - Spouse Share Sum
      const raddPoolFraction = subtractFractions(
        oneWhole,
        spouseFixedShareFractionSum
      );

      // 2. Radd-eligible heirs (non-spouse Faraid heirs with a share)
      const raddEligibleHeirs = survivingHeirs.filter(
        (h) =>
          h.classification === "As-hab al-Faraid" &&
          h.finalShareFraction.num > 0 &&
          !h.name_en.includes("Wife") &&
          !h.name_en.includes("Husband")
      );

      // 3. Calculate the sum of shares *eligible for Radd* (e.g., Daughters' 2/3 share)
      const sumOfEligibleSharesFraction = raddEligibleHeirs.reduce(
        (sum, h) => addFractions(sum, h.finalShareFraction),
        { num: 0, den: 1 }
      );

      if (sumOfEligibleSharesFraction.num > 0) {
        survivingHeirs = survivingHeirs.map((heir) => {
          let updatedHeir = { ...heir };

          const isSpouse =
            updatedHeir.name_en === "Husband" || updatedHeir.name_en === "Wife";

          if (isSpouse) {
            // Spouse keeps their fixed share (locked in Step 6).
            const fixedShare = heir.finalShareFraction;
            updatedHeir.finalShareFraction = { ...fixedShare };
            updatedHeir.status = `FARAD: Fixed Share Maintained at ${fixedShare.num}/${fixedShare.den} (Not Radd Eligible)`;
          } else {
            // Non-Spouse Radd-eligible heirs
            const eligibleHeirData = raddEligibleHeirs.find(
              (r) => r.name_en === updatedHeir.name_en
            );

            if (eligibleHeirData) {
              // Proportion = (Heir Share / Sum of Eligible Shares)
              const proportionFraction = divideFractions(
                eligibleHeirData.finalShareFraction,
                sumOfEligibleSharesFraction
              );

              // The new total share for the Radd-eligible heir is: Radd Pool * Proportion
              updatedHeir.finalShareFraction = multiplyFractions(
                raddPoolFraction,
                proportionFraction
              );

              updatedHeir.status += ` (Radd applied: New total share ${updatedHeir.finalShareFraction.num}/${updatedHeir.finalShareFraction.den})`;
            } else {
              // All other non-spouse, non-eligible heirs get zero.
              updatedHeir.finalShareFraction = { num: 0, den: 1 };
              if (!updatedHeir.isExcluded) {
                updatedHeir.status = updatedHeir.status.includes("ASABA")
                  ? updatedHeir.status + " (Residue 0)"
                  : "NOT ALLOCATED";
              }
            }
          }
          return updatedHeir;
        });
      }
      totalFinalShareFraction = oneWhole;
      totalFinalShareDecimal = 1.0;
    }
    // --- END NEW ROBUST RADD LOGIC ---
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
