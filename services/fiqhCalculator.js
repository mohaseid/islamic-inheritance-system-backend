const pool = require("../db");

/**
 * Main function to calculate inheritance shares according to Fiqh principles.
 * @param {object} input - Contains deceased, assets, liabilities, and heirs list.
 * @returns {object} - The final calculation result.
 */
exports.calculateShares = async (input) => {
  const { deceased, assets, liabilities, heirs } = input; // Deceased gender is now used

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

    // Log for debugging: Check how names map to database entries.
    console.log(
      "Input Heir Names from Frontend:",
      heirs.map((h) => h.name)
    );
    console.log(
      "Database Names and Shares Retrieved:",
      detailsResult.rows.map((d) => ({
        name: d.name_en,
        share: d.default_share,
        classification: d.classification,
      }))
    );
    console.log("Wife Data Retrieved via Map Lookup:", detailsMap.get("Wife"));

    // 2. Map frontend heirs with database details
    heirsWithDetails = heirs.map((h) => ({
      ...h,
      // The frontend name (h.name) must match a key in detailsMap (d.name_en).
      ...detailsMap.get(h.name),
      isExcluded: false,
      finalShare: 0,
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

  const descendantIsPresent = survivingHeirs.some(
    (h) => h.name_en === "Son" || h.name_en === "Daughter"
  );

  survivingHeirs = survivingHeirs.map((heir) => {
    if (heir.name_en === "Husband" && descendantIsPresent) {
      return {
        ...heir,
        default_share: 0.25, // Change from 1/2 (0.5) to 1/4 (0.25) is handled by DB rules
        status: "FARAD: Reduced by Descendants",
      };
    } else if (heir.name_en === "Wife" && descendantIsPresent) {
      return {
        ...heir,
        default_share: 0.125, // Change from 1/4 (0.25) to 1/8 (0.125)
        status: "FARAD: Reduced by Descendants",
      };
    }
    return heir;
  });

  // 3. CRITICAL FIX: Asaba bi-ghayrihi (Daughter with Son) Rule
  const sonIsPresent = survivingHeirs.some((h) => h.name_en === "Son");

  if (sonIsPresent) {
    survivingHeirs = survivingHeirs.map((heir) => {
      if (heir.name_en === "Daughter") {
        // Daughter becomes Asaba (residuary) with Son, losing her fixed share (1/2)
        // Daughter becomes Asaba (residuary) with Son, losing her fixed share
        return {
          ...heir,
          classification: "Asaba",
          default_share: null, // Critical: Remove fixed share
          status: "ASABA (with Son)",
        };
      }
      return heir;
    });
  }

  // 3. CRITICAL FIX: Father as pure Asaba Rule
  // 4. CRITICAL FIX: Father as pure Asaba Rule
  // Father's share is 1/6 (fixed) when descendants exist.
  // Father's share is Asaba (residue) when NO descendants exist.
  if (
    survivingHeirs.some((h) => h.name_en === "Father") &&
    !descendantIsPresent
  ) {
    survivingHeirs = survivingHeirs.map((heir) => {
      if (heir.name_en === "Father") {
        // Father takes the residue if no descendants are present
        return {
          ...heir,
          classification: "Asaba",
          default_share: null, // Critical: Father enters Asaba calculation
          status: "ASABA (No Descendants)",
        };
      }
      return heir;
    });
  }

  // 5. Apply Fixed Share (As-hab al-Faraid) Rules
  let totalFaraidShare = 0;

  // 4. Apply Fixed Share (As-hab al-Faraid) Rules
  const faraidHeirs = survivingHeirs.filter(
    (h) => h.classification === "As-hab al-Faraid"
  );

  faraidHeirs.forEach((heir) => {
    let finalShare = heir.default_share;

    const reductionRules = allRules.filter(
      (r) =>
        r.condition_type === "Reduction" && r.primary_heir_name === heir.name_en
    );

    reductionRules.forEach((rule) => {
      // Check if the condition heir for reduction is present
      const isConditionPresent = survivingHeirs.some(
        (h) => h.name_en === rule.condition_heir_name && h.count > 0
      );

      // If condition is met, apply the reduction factor
      if (isConditionPresent && rule.reduction_factor !== null) {
        finalShare = rule.reduction_factor;
        heir.status = `FARAD: Reduced to ${rule.reduction_factor} by ${rule.condition_heir_name}`;
      }
    });

    if (finalShare > 0) {
      heir.finalShare = finalShare * heir.count;
      totalFaraidShare += heir.finalShare;
      heir.status = heir.status.startsWith("FARAD")
        ? heir.status
        : `FARAD: Allocated ${finalShare}`;
    }
  });

  // 5. Apply Residue (Asaba) Rules
  // NOTE: You must also ensure your FiqhRules table has the correct reduction rules for Daughters (1/2 for one, 2/3 for two/more)
  // Since the original code handles reduction rules, the logic below might be the culprit.

  // 6. Apply Residue (Asaba) Rules
  let residueFraction = 1.0 - totalFaraidShare;
  let asabaHeirs = survivingHeirs.filter((h) => h.classification === "Asaba");

  // ... (The Asaba calculation logic here looks fine for distributing the remainder)

  if (residueFraction > 0 && asabaHeirs.length > 0) {
    let totalAsabaPoints = 0;

    asabaHeirs.forEach((heir) => {
      // Assign points for 2:1 male:female ratio
      if (
        heir.name_en &&
        (heir.name_en.includes("Son") ||
          heir.name_en.includes("Brother") ||
          heir.name_en === "Father")
      ) {
        heir.points = heir.count * 2;
      } else if (
        heir.name_en &&
        (heir.name_en.includes("Daughter") || heir.name_en.includes("Sister"))
      ) {
        heir.points = heir.count * 1;
      } else {
        heir.points = 0;
      }
      totalAsabaPoints += heir.points;
    });

    if (totalAsabaPoints > 0) {
      asabaHeirs.forEach((heir) => {
        if (heir.points > 0) {
          const asabaShare = residueFraction * (heir.points / totalAsabaPoints);
          heir.finalShare += asabaShare;
          heir.status = heir.status.includes("ASABA")
            ? heir.status + ` (Allocated Residue of ${asabaShare.toFixed(4)})`
            : `ASABA: Allocated Residue of ${asabaShare.toFixed(4)}`;
          heir.classification = "Asaba (Residue)";
        }
      });
    }
  }

  // 6. Reconciliation (Awl and Radd)
  // 7. Reconciliation (Awl and Radd)
  let totalFinalShare = survivingHeirs.reduce(
    (sum, h) => sum + h.finalShare,
    0
  );

  const hasAsaba = survivingHeirs.some(
    (h) => h.classification && h.classification.includes("Asaba")
  );
  let reconciliationStatus = "Balanced";

  // Awl (Increase): Total Faraid share exceeds 1.0
  if (totalFinalShare > 1.0001) {
    reconciliationStatus = "Awl (Increase)";
    const awlFactor = totalFinalShare;

    survivingHeirs.forEach((heir) => {
      if (heir.finalShare > 0) {
        heir.finalShare = heir.finalShare / awlFactor;
      }
    });
    totalFinalShare = 1.0;
  }

  // Radd (Return): Residue remains and there is no Asaba heir
  if (totalFinalShare < 0.9999 && !hasAsaba) {
    reconciliationStatus = "Radd (Return)";

    const residueForRadd = 1.0 - totalFinalShare;

    const raddHeirs = survivingHeirs.filter(
      (h) =>
        h.classification === "As-hab al-Faraid" &&
        h.name_en &&
        !h.name_en.includes("Wife"), // Exclude Spouse from Radd
      !h.name_en.includes("Wife") && // Exclude Spouse from Radd
        !h.name_en.includes("Husband") // Exclude Spouse from Radd
    );

    const sumOfEligibleShares = raddHeirs.reduce(
      (sum, h) => sum + h.finalShare,
      0
    );

    if (sumOfEligibleShares > 0) {
      raddHeirs.forEach((heir) => {
        const proportion = heir.finalShare / sumOfEligibleShares;
        const raddAmount = residueForRadd * proportion;

        heir.finalShare += raddAmount;
      });
    }
    totalFinalShare = 1.0;
  }

  // 7. Final Output
  // 8. Final Output
  return {
    netEstate: netEstate,
    totalFractionAllocated: totalFinalShare,
    reconciliation: reconciliationStatus,
    shares: survivingHeirs.map((h) => ({
      heir: h.name_en,
      count: h.count,
      classification: h.classification,
      share_fraction_of_total: h.finalShare,
      share_amount: h.finalShare * netEstate,
      status: h.status,
    })),
    notes: `Calculation finished. Reconciliation status: ${reconciliationStatus}`,
  };
};
