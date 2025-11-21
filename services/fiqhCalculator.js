const pool = require("../db");

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
    throw new Error("Failed to retrieve inheritance rules from the database.");
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
      heir.status = `FARAD: Allocated ${finalShare}`;
    }
  });

  const residue = 1.0 - totalFaraidShare;
  let asabaHeirs = survivingHeirs.filter((h) => h.classification === "Asaba");

  if (residue > 0 && asabaHeirs.length > 0) {
    asabaHeirs[0].finalShare += residue;
    asabaHeirs[0].status = `ASABA: Allocated Residue of ${residue}`;
  }

  return {
    netEstate: netEstate,
    totalFractionAllocated: totalFaraidShare + residue,
    shares: survivingHeirs.map((h) => ({
      heir: h.name_en,
      count: h.count,
      classification: h.classification,
      share_fraction_of_total: h.finalShare,
      share_amount: h.finalShare * netEstate,
      status: h.status,
    })),
    notes:
      "Farā'id shares and initial reduction logic applied. Radd/Awl and precise Asaba distribution needed next.",
  };
};
