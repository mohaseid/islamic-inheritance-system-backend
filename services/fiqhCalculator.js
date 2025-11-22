const pool = require("../db");

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

  // Determine if any descendant is present
  const descendantIsPresent = survivingHeirs.some(
    (h) => h.name_en === "Son" || h.name_en === "Daughter"
  );

  // Check if a Son is present (to switch Daughter to Asaba)
  const sonIsPresent = survivingHeirs.some((h) => h.name_en === "Son");

  // === DYNAMIC SHARE ADJUSTMENTS BASED ON PRESENCE AND COUNT ===

  // 2. Spouse Share Reduction (Presence of Descendants)
  survivingHeirs = survivingHeirs.map((heir) => {
    if (heir.name_en === "Husband") {
      // Husband's share is 1/2 (0.5) without descendants, 1/4 (0.25) with descendants
      const newShare = descendantIsPresent ? 0.25 : 0.5;
      return {
        ...heir,
        default_share: newShare,
        status: `FARAD: Allocated ${newShare} (Descendants: ${
          descendantIsPresent ? "Yes" : "No"
        })`,
      };
    } else if (heir.name_en === "Wife") {
      // Wife's share is 1/4 (0.25) without descendants, 1/8 (0.125) with descendants
      const newShare = descendantIsPresent ? 0.125 : 0.25;
      return {
        ...heir,
        default_share: newShare,
        status: `FARAD: Allocated ${newShare} (Descendants: ${
          descendantIsPresent ? "Yes" : "No"
        })`,
      };
    }
    return heir;
  });

  // 3. Daughter Fixed Share based on Count (ONLY if no Son is present)
  survivingHeirs = survivingHeirs.map((heir) => {
    if (heir.name_en === "Daughter" && !sonIsPresent) {
      if (heir.count >= 2) {
        // Two or more daughters get 2/3 collectively (~0.6667)
        return {
          ...heir,
          default_share: 2 / 3, // Set collective share to 2/3
          status: "FARAD: Allocated 2/3 (Multiple Daughters)",
        };
      } else if (heir.count === 1) {
        // One daughter gets 1/2 (0.5)
        return {
          ...heir,
          default_share: 0.5, // Set share to 1/2
          status: "FARAD: Allocated 1/2 (Single Daughter)",
        };
      }
    }
    return heir;
  });

  // 4. CRITICAL FIX: Asaba bi-ghayrihi (Daughter with Son) Rule
  if (sonIsPresent) {
    survivingHeirs = survivingHeirs.map((heir) => {
      if (heir.name_en === "Daughter") {
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

  // 5. CRITICAL FIX: Father as pure Asaba Rule
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

  // 6. Apply Fixed Share (As-hab al-Faraid) Rules
  let totalFaraidShare = 0;

  const faraidHeirs = survivingHeirs.filter(
    (h) => h.classification === "As-hab al-Faraid" && h.default_share !== null
  );

  faraidHeirs.forEach((heir) => {
    let finalShare = heir.default_share;

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
        finalShare = rule.reduction_factor;
        heir.status = `FARAD: Reduced to ${rule.reduction_factor} by ${rule.condition_heir_name}`;
      }
    });

    if (finalShare > 0) {
      // The finalShare here represents the COLLECTIVE fraction for the group.
      heir.finalShare = finalShare;
      totalFaraidShare += heir.finalShare;
      heir.status = heir.status.startsWith("FARAD")
        ? heir.status
        : `FARAD: Allocated ${finalShare}`;
    }
  });

  // 7. Apply Residue (Asaba) Rules
  let residueFraction = 1.0 - totalFaraidShare;
  let asabaHeirs = survivingHeirs.filter((h) => h.classification === "Asaba");

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

  // 8. Reconciliation (Awl and Radd)
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

    // IMPORTANT: Exclude all spouses from Radd eligibility.
    const raddHeirs = survivingHeirs.filter(
      (h) =>
        h.classification === "As-hab al-Faraid" &&
        h.finalShare > 0 &&
        h.name_en &&
        !h.name_en.includes("Wife") &&
        !h.name_en.includes("Husband")
    );

    // The spouse's share must be preserved exactly as it was calculated (1/4)
    const spouseHeir = survivingHeirs.find(
      (h) => h.name_en === "Husband" || h.name_en === "Wife"
    );
    const preservedSpouseShare = spouseHeir ? spouseHeir.finalShare : 0;

    // Calculate the sum of shares *eligible for Radd* (Daughters' 2/3 share)
    const sumOfEligibleShares = raddHeirs.reduce(
      (sum, h) => sum + h.finalShare,
      0
    );

    // The available residue for Radd is the total residue minus the spouse's share.
    // Wait, the totalFinalShare already includes the spouse's share, so the residue
    // is correctly 1.0 - totalFinalShare. The Radd only applies to the *non-spouse* Faraid heirs.

    if (sumOfEligibleShares > 0) {
      // 🎯 The Fix: The Radd amount should only be distributed among the Radd-eligible heirs (Daughters).
      raddHeirs.forEach((heir) => {
        const proportion = heir.finalShare / sumOfEligibleShares;
        const raddAmount = residueForRadd * proportion;
        // Add the Radd amount to the daughter's existing share (2/3)
        heir.finalShare += raddAmount;
      });
      // The Spouse's share (1/4) remains unchanged and is included in the final allocation.
    }
    totalFinalShare = 1.0;
  }

  // 9. Final Output
  return {
    netEstate: netEstate,
    totalFractionAllocated: totalFinalShare,
    reconciliation: reconciliationStatus,
    shares: survivingHeirs.map((h) => ({
      heir: h.name_en,
      count: h.count,
      classification: h.classification,
      // Fix: Ensure that if a spouse exists and has a finalShare, it's not divided by count (which is always 1).
      // We also need to split the Daughter's collective share among the count for the output display.
      share_fraction_of_total: h.finalShare,
      share_amount: h.finalShare * netEstate,
      status: h.status,
    })),
    notes: `Calculation finished. Reconciliation status: ${reconciliationStatus}`,
  };
};
