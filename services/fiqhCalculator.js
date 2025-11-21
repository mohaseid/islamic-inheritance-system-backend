const pool = require("../db");

/**
 * Main function to calculate inheritance shares according to Fiqh principles.
 * @param {object} input - Contains deceased, assets, liabilities, and heirs list.
 * @returns {object} - The final calculation result.
 */
exports.calculateShares = async (input) => {
  const { assets, liabilities, heirs } = input;

  const netEstate = assets - liabilities;

  let heirsWithDetails = [];
  let allRules = [];

  try {
    const heirDetailsQuery = `
            SELECT heir_type_id, name_en, classification, default_share 
            FROM HeirTypes 
            WHERE name_en = ANY($1::text[])
        `;
    const detailsResult = await pool.query(heirDetailsQuery, [
      heirs.map((h) => h.name),
    ]);
    const detailsMap = new Map(detailsResult.rows.map((d) => [d.name_en, d]));

    heirsWithDetails = heirs.map((h) => ({
      ...h,
      ...detailsMap.get(h.name),
      isExcluded: false,
      finalShare: 0,
      status: "PENDING",
    }));

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
          heirsWithDetails[excludedIndex].status = "EXCLUDED";
        }
      }
    });

  let survivingHeirs = heirsWithDetails.filter((h) => !h.isExcluded);
  let totalFaraidShare = 0;

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
      const isConditionPresent = survivingHeirs.some(
        (h) => h.name_en === rule.condition_heir_name && h.count > 0
      );

      if (isConditionPresent && rule.reduction_factor !== null) {
        finalShare = rule.reduction_factor;
        heir.status = `FARAD: Reduced to ${rule.reduction_factor}`;
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

  let residueFraction = 1.0 - totalFaraidShare;
  let asabaHeirs = survivingHeirs.filter((h) => h.classification === "Asaba");

  if (residueFraction > 0 && asabaHeirs.length > 0) {
    let totalAsabaPoints = 0;

    asabaHeirs.forEach((heir) => {
      if (
        heir.name_en &&
        (heir.name_en.includes("Son") || heir.name_en.includes("Brother"))
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
          heir.status = `ASABA: Allocated Residue of ${asabaShare.toFixed(4)}`;
          heir.classification = "Asaba (Residue)";
        }
      });
    }
  }

  let totalFinalShare = survivingHeirs.reduce(
    (sum, h) => sum + h.finalShare,
    0
  );
  const hasAsaba = survivingHeirs.some((h) =>
    h.classification.includes("Asaba")
  );
  let reconciliationStatus = "Balanced";

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

  if (totalFinalShare < 0.9999 && !hasAsaba) {
    reconciliationStatus = "Radd (Return)";

    const residueForRadd = 1.0 - totalFinalShare;

    const raddHeirs = survivingHeirs.filter(
      (h) =>
        h.classification === "As-hab al-Faraid" && !h.name_en.includes("Spouse")
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
