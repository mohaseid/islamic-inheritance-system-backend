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

  // === DYNAMIC SHARE ADJUSTMENTS BASED ON PRESENCE AND COUNT (Using map for immutability) ===

  survivingHeirs = survivingHeirs.map((heir) => {
    let updatedHeir = { ...heir };

    // 2. Spouse Share Reduction (Presence of Descendants)
    if (updatedHeir.name_en === "Husband") {
      const newShare = descendantIsPresent ? 0.25 : 0.5;
      updatedHeir.default_share = newShare;
      updatedHeir.status = `FARAD: Allocated ${newShare} (Descendants: ${
        descendantIsPresent ? "Yes" : "No"
      })`;
    } else if (updatedHeir.name_en === "Wife") {
      const newShare = descendantIsPresent ? 0.125 : 0.25;
      updatedHeir.default_share = newShare;
      updatedHeir.status = `FARAD: Allocated ${newShare} (Descendants: ${
        descendantIsPresent ? "Yes" : "No"
      })`;
    }

    // 3. Daughter Fixed Share based on Count (ONLY if no Son is present)
    if (updatedHeir.name_en === "Daughter" && !sonIsPresent) {
      if (updatedHeir.count >= 2) {
        updatedHeir.default_share = 2 / 3; // Set collective share to 2/3
        updatedHeir.status = "FARAD: Allocated 2/3 (Multiple Daughters)";
      } else if (updatedHeir.count === 1) {
        updatedHeir.default_share = 0.5; // Set share to 1/2
        updatedHeir.status = "FARAD: Allocated 1/2 (Single Daughter)";
      }
    }

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

  // 6. Apply Fixed Share (As-hab al-Faraid) Rules
  let totalFaraidShare = 0;

  survivingHeirs = survivingHeirs.map((heir) => {
    if (
      heir.classification !== "As-hab al-Faraid" ||
      heir.default_share === null
    ) {
      return heir; // Skip non-Faraid heirs or those set to null share (like Asaba father)
    }

    let updatedHeir = { ...heir };
    let finalShare = updatedHeir.default_share;

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
        updatedHeir.status = `FARAD: Reduced to ${rule.reduction_factor} by ${rule.condition_heir_name}`;
      }
    });

    if (finalShare > 0) {
      updatedHeir.finalShare = finalShare;
      // Total Faraid share is calculated based on the COLLECTIVE share for the group
      totalFaraidShare += updatedHeir.finalShare;
      updatedHeir.status = updatedHeir.status.startsWith("FARAD")
        ? updatedHeir.status
        : `FARAD: Allocated ${finalShare}`;
    }
    return updatedHeir;
  });

  // 7. Apply Residue (Asaba) Rules
  let residueFraction = 1.0 - totalFaraidShare;
  let asabaHeirs = survivingHeirs.filter((h) => h.classification === "Asaba");

  if (residueFraction > 0 && asabaHeirs.length > 0) {
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
        const asabaShare =
          residueFraction * (updatedHeir.points / totalAsabaPoints);
        updatedHeir.finalShare += asabaShare;
        updatedHeir.status = updatedHeir.status.includes("ASABA")
          ? updatedHeir.status +
            ` (Allocated Residue of ${asabaShare.toFixed(4)})`
          : `ASABA: Allocated Residue of ${asabaShare.toFixed(4)}`;
        updatedHeir.classification = "Asaba (Residue)";
        return updatedHeir;
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

    survivingHeirs = survivingHeirs.map((heir) => {
      let updatedHeir = { ...heir };
      if (updatedHeir.finalShare > 0) {
        updatedHeir.finalShare = updatedHeir.finalShare / awlFactor;
      }
      return updatedHeir;
    });
    totalFinalShare = 1.0;
  }

  // Radd (Return): Residue remains and there is no Asaba heir
  if (totalFinalShare < 0.9999 && !hasAsaba) {
    reconciliationStatus = "Radd (Return)";

    // Spouses must be excluded from receiving Radd
    const spouseHeirs = survivingHeirs.filter(
      (h) => h.name_en === "Husband" || h.name_en === "Wife"
    );
    const spouseShareSum = spouseHeirs.reduce(
      (sum, h) => sum + h.finalShare,
      0
    );

    // The residue available for distribution among Radd-eligible heirs (e.g., Daughters)
    const residueForRadd = 1.0 - totalFinalShare;

    // Radd-eligible heirs (non-spouse Faraid heirs with a share)
    const raddHeirs = survivingHeirs.filter(
      (h) =>
        h.classification === "As-hab al-Faraid" &&
        h.finalShare > 0 &&
        !h.name_en.includes("Wife") &&
        !h.name_en.includes("Husband")
    );

    // Calculate the sum of shares *eligible for Radd* (Daughters' 2/3 share)
    const sumOfEligibleShares = raddHeirs.reduce(
      (sum, h) => sum + h.finalShare,
      0
    );

    if (sumOfEligibleShares > 0) {
      survivingHeirs = survivingHeirs.map((heir) => {
        let updatedHeir = { ...heir };

        // Check if this heir is eligible for Radd
        const isRaddEligible = raddHeirs.some(
          (r) => r.name_en === updatedHeir.name_en
        );

        if (isRaddEligible) {
          // The proportion based on their initial share
          const proportion = updatedHeir.finalShare / sumOfEligibleShares;

          // Add the Radd amount to the heir's existing share
          updatedHeir.finalShare += residueForRadd * proportion;
          updatedHeir.status += ` (Radd applied: +${(
            residueForRadd * proportion
          ).toFixed(4)})`;
        } else if (spouseHeirs.some((s) => s.name_en === updatedHeir.name_en)) {
          // Spouse's share is maintained and explicitly excluded from Radd calculation
          updatedHeir.status +=
            " (Spouse: Share maintained, excluded from Radd)";
        }
        return updatedHeir;
      });
    }
    totalFinalShare = 1.0;
  }

  // 9. Final Output
  return {
    netEstate: netEstate,
    totalFractionAllocated: totalFinalShare,
    reconciliation: reconciliationStatus,
    shares: survivingHeirs.map((h) => {
      // The finalShare is the COLLECTIVE share for the group (e.g., 3/4 for all Daughters).

      return {
        heir: h.name_en,
        count: h.count,
        classification: h.classification,
        // Share fraction of total is the group's total claim on the estate
        share_fraction_of_total: h.finalShare,
        share_amount: h.finalShare * netEstate,
        status: h.status,
      };
    }),
    notes: `Calculation finished. Reconciliation status: ${reconciliationStatus}`,
  };
};
