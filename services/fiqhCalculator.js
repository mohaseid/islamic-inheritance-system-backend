const pool = require("../db");

/**
 * Main function to calculate inheritance shares according to Fiqh principles.
 * @param {object} input - Contains deceased, assets, liabilities, and heirs list.
 * @returns {object} - The final calculation result.
 */
exports.calculateShares = async (input) => {
  const { deceased, assets, liabilities, heirs } = input;

  const netEstate = assets - liabilities;

  const heirNames = heirs.map((h) => h.name);
  let allRules = [];

  try {
    const ruleQuery = `
            SELECT 
                t1.name_en AS primary_heir_name,
                t2.name_en AS condition_heir_name,
                r.condition_type,
                r.reduction_factor,
                r.description_en
            FROM FiqhRules r
            JOIN HeirTypes t1 ON r.heir_type_id = t1.heir_type_id
            LEFT JOIN HeirTypes t2 ON r.condition_heir_id = t2.heir_type_id
            WHERE t1.name_en = ANY($1::text[]) OR t2.name_en = ANY($1::text[]);
        `;
    const result = await pool.query(ruleQuery, [heirNames]);
    allRules = result.rows;
  } catch (error) {
    console.error("Database query for Fiqh Rules failed:", error);
    throw new Error("Failed to retrieve inheritance rules from the database.");
  }

  let survivingHeirs = heirs.map((h) => ({
    ...h,
    isExcluded: false,
    finalShareFraction: null,
    classification: null,
  }));

  allRules
    .filter((r) => r.condition_type === "Exclusion")
    .forEach((rule) => {
      const isConditionPresent = survivingHeirs.some(
        (h) => h.name === rule.condition_heir_name && h.count > 0
      );

      if (isConditionPresent) {
        const excludedIndex = survivingHeirs.findIndex(
          (h) => h.name === rule.primary_heir_name
        );
        if (excludedIndex !== -1) {
          survivingHeirs[excludedIndex].isExcluded = true;
          console.log(
            `EXCLUDED: ${rule.primary_heir_name} by ${rule.condition_heir_name}`
          );
        }
      }
    });

  survivingHeirs = survivingHeirs.filter((h) => !h.isExcluded);

  return {
    netEstate: netEstate,
    shares: survivingHeirs.map((h) => ({
      heir: h.name,
      status: h.isExcluded ? "Excluded" : "Pending Calculation",
    })),
    rulesApplied: allRules.length,
    notes:
      "Initial exclusion logic applied. Shares and residue calculation needed next.",
  };
};
