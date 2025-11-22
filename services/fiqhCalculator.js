const pool = require("../db");

// --- UTILITY FUNCTIONS FOR EXACT FRACTION ARITHMETIC (No changes here) ---

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
  const oneWhole = { num: 1, den: 1 };
  let reconciliationStatus = "Balanced";

  let heirsWithDetails = [];
  let allRules = [];

  // Standardize heir names to Title Case for database compatibility (e.g., "husband" -> "Husband")
  const heirNames = heirs.map(
    (h) => h.name.charAt(0).toUpperCase() + h.name.slice(1).toLowerCase()
  );

  if (heirNames.length === 0) {
    return {
      netEstate: netEstate,
      totalFractionAllocated: 0,
      reconciliation: "No Heirs",
      shares: [],
      notes: "Calculation failed: No heirs provided.",
    };
  }

  // --- DATABASE QUERIES (Robust Error Handling) ---
  let detailsResult, ruleResult;
  try {
    // Log the standardized names being sent to the database
    console.log("Standardized Heir Names sent to DB:", heirNames);

    // 1. Retrieve Heir Details (Classification and Default Share)
    // IMPORTANT: Casting default_share to FLOAT to ensure the value is a number in JS
    const heirDetailsQuery = `
            SELECT 
                heir_type_id, 
                name_en, 
                classification, 
                CAST(default_share AS FLOAT) AS default_share
            FROM HeirTypes 
            WHERE name_en = ANY($1::text[])
        `;
    detailsResult = await pool.query(heirDetailsQuery, [heirNames]);
    const detailsMap = new Map(detailsResult.rows.map((d) => [d.name_en, d]));

    // **CRITICAL CHECK 1**: Ensure every heir sent has a corresponding DB entry.
    if (detailsResult.rows.length !== heirNames.length) {
      const foundNames = detailsResult.rows.map((r) => r.name_en);
      const missingNames = heirNames.filter(
        (name) => !foundNames.includes(name)
      );
      if (missingNames.length > 0) {
        throw new Error(
          `Database error: Could not find entries for standardized heir types: ${missingNames.join(
            ", "
          )}. Please check your database table ('HeirTypes') for correct spelling/casing (e.g., 'Husband', 'Wife').`
        );
      }
    }

    // 2. Map frontend heirs with database details
    heirsWithDetails = heirs.map((h) => {
      // Use the standardized name (Title Case) to look up details
      const standardizedName =
        h.name.charAt(0).toUpperCase() + h.name.slice(1).toLowerCase();
      const details = detailsMap.get(standardizedName); // Try to get the details

      // **CRITICAL CHECK 2 (Failsafe)**: Throw a precise error if details are missing or malformed.
      if (!details || !details.classification) {
        // If details is null, the name didn't match anything.
        if (!details) {
          throw new Error(
            `Critical Data Error: Database entry for '${standardizedName}' was not found in 'HeirTypes'.`
          );
        }
        // If classification is missing
        throw new Error(
          `Critical Data Error: Database entry for '${standardizedName}' is missing or incomplete. Specifically, the 'classification' field is missing. Please verify the entry in the 'HeirTypes' table.`
        );
      }

      return {
        ...h,
        ...details,
        isExcluded: false,
        finalShareFraction: { num: 0, den: 1 },
        // Crucial: The `name_en` used in subsequent logic must be the standardized one
        name_en: standardizedName,
      };
    });

    // 3. Retrieve Fiqh Rules (Exclusion and Reduction)
    const ruleQuery = `
            SELECT 
                t1.name_en AS primary_heir_name,
                t2.name_en AS condition_heir_name,
                r.condition_type,
                CAST(r.reduction_factor AS FLOAT) AS reduction_factor
            FROM FiqhRules r
            JOIN HeirTypes t1 ON r.heir_type_id = t1.heir_type_id
            LEFT JOIN HeirTypes t2 ON r.condition_heir_id = t2.heir_type_id
            WHERE t1.name_en = ANY($1::text[]) OR t2.name_en = ANY($1::text[]);
        `;
    ruleResult = await pool.query(ruleQuery, [heirNames]);
    allRules = ruleResult.rows;
  } catch (error) {
    // Log the full stack for the server error
    console.error(
      "Database query failed during Fiqh calculation setup:",
      error.stack
    );
    // Re-throw the error as a standard message for the frontend
    throw new Error(
      `Failed to initialize calculation (Database Step 1-3 error). Please check server logs for details. Error reported: ${error.message}`
    );
  }
  // --- END DATABASE QUERIES ---

  // 1. Apply Exclusion (Hajb) Rules
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
  const survivingHeirCount = survivingHeirs.length;

  // --- START DEFINITIVE SINGLE-HEIR CHECK AND EARLY EXIT ---
  if (survivingHeirCount === 1) {
    const onlyHeir = survivingHeirs[0];

    // Any single, surviving heir takes the entire estate (Radd or Asaba).
    onlyHeir.finalShareFraction = oneWhole;

    // Determine classification for status note
    const classificationType =
      onlyHeir.classification && onlyHeir.classification.includes("Asaba")
        ? "Asaba"
        : "Faraid";
    const statusType =
      classificationType === "Asaba"
        ? "Balanced (Asaba)"
        : "Radd (Return - Single Heir)";

    onlyHeir.status = `FINAL: Takes full estate (1/1) by ${statusType} rule.`;
    reconciliationStatus = statusType;

    // Allocation is finalized, return results now.
    return {
      netEstate: netEstate,
      totalFractionAllocated: 1.0,
      reconciliation: reconciliationStatus,
      shares: survivingHeirs.map((h) => {
        const finalShareDecimal = toDecimal(h.finalShareFraction);
        return {
          heir: h.name_en,
          count: h.count,
          classification: h.classification,
          share_fraction_of_total: finalShareDecimal,
          share_amount: finalShareDecimal * netEstate,
          status: h.status,
        };
      }),
      notes: `Calculation finished. Reconciliation status: ${reconciliationStatus}. Total Final Fraction: 1/1`,
    };
  }
  // --- END DEFINITIVE SINGLE-HEIR CHECK AND EARLY EXIT ---

  // --- DYNAMIC SHARE ADJUSTMENTS (for Multi-Heir Scenarios) ---

  // Determine if any descendant is present (Needed for Spouse/Father share reduction)
  const descendantIsPresent = survivingHeirs.some(
    (h) => h.name_en === "Son" || h.name_en === "Daughter"
  );

  // Check if a Son is present (to switch Daughter to Asaba)
  const sonIsPresent = survivingHeirs.some((h) => h.name_en === "Son");

  survivingHeirs = survivingHeirs.map((heir) => {
    let updatedHeir = { ...heir };
    let newDecimalShare = updatedHeir.default_share;

    // 2. Spouse Share Reduction (Presence of Descendants)
    if (updatedHeir.name_en === "Husband") {
      newDecimalShare = descendantIsPresent ? 0.25 : 0.5;
      updatedHeir.status = `FARAD: Allocated ${
        toFraction(newDecimalShare).num
      }/${toFraction(newDecimalShare).den} (Descendants: ${
        descendantIsPresent ? "Yes" : "No"
      })`;
    } else if (updatedHeir.name_en === "Wife") {
      newDecimalShare = descendantIsPresent ? 0.125 : 0.25;
      updatedHeir.status = `FARAD: Allocated ${
        toFraction(newDecimalShare).num
      }/${toFraction(newDecimalShare).den} (Descendants: ${
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
  let totalFixedFaraidShareFraction = { num: 0, den: 1 };

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

        // Calculate total fixed share based on the *group's* total share
        totalFixedFaraidShareFraction = addFractions(
          totalFixedFaraidShareFraction,
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

  let totalFinalShareDecimal = toDecimal(totalFixedFaraidShareFraction);

  // --- STANDARD MULTI-HEIR LOGIC CONTINUES FROM HERE ---

  const hasAsaba = survivingHeirs.some(
    (h) => h.classification && h.classification.includes("Asaba")
  );

  // 7. Apply Residue (Asaba) Rules (Multi-heir path)
  let residueFraction = subtractFractions(
    oneWhole,
    totalFixedFaraidShareFraction
  );
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
      // Recalculate totals after Asaba distribution
      totalFixedFaraidShareFraction = oneWhole;
      totalFinalShareDecimal = 1.0;
    }
  }

  // 8. Reconciliation (Awl and Radd)

  // Recalculate total share after Asaba/Faraid processing
  totalFixedFaraidShareFraction = survivingHeirs.reduce(
    (sumFraction, h) => addFractions(sumFraction, h.finalShareFraction),
    { num: 0, den: 1 }
  );
  totalFinalShareDecimal = toDecimal(totalFixedFaraidShareFraction);

  // Awl (Increase): Total Faraid share exceeds 1.0
  if (totalFinalShareDecimal > 1.0001) {
    reconciliationStatus = "Awl (Increase)";

    const awlFactor = totalFixedFaraidShareFraction;

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
    totalFixedFaraidShareFraction = oneWhole;
    totalFinalShareDecimal = 1.0;
  }

  // Radd (Return): Residue remains and there is no Asaba heir (for multiple heirs)
  if (totalFinalShareDecimal < 0.9999 && !hasAsaba) {
    reconciliationStatus = "Radd (Return)";

    // Calculate the total fixed share for all spouses
    const spouseHeirs = survivingHeirs.filter(
      (h) => h.name_en === "Husband" || h.name_en === "Wife"
    );
    let spouseFixedShareFractionSum = spouseHeirs.reduce(
      (sum, h) => addFractions(sum, h.finalShareFraction),
      { num: 0, den: 1 }
    );

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

    // 3. Calculate the sum of shares *eligible for Radd*
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
    totalFixedFaraidShareFraction = oneWhole;
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
    notes: `Calculation finished. Reconciliation status: ${reconciliationStatus}. Total Final Fraction: ${totalFixedFaraidShareFraction.num}/${totalFixedFaraidShareFraction.den}`,
  };
};
