/**
 * @fileoverview Core service for calculating Islamic inheritance shares (Fara'id).
 * This service implements the logic for determining fixed shares (Fard), reduction (Hajib), and the return (Radd).
 * * * * NOTE: Currently supports:
 * 1. Sole Spouse (Husband or Wife) (Fard + Radd = 100%).
 * 2. Spouse + one single Residuary Heir (Asaba), assuming no descendants (Fard + Ta'sib).
 * 3. Spouse + Descendants (Sons/Daughters) (Fard Reduction + Ta'sib for Children).
 */

// --- Fiqh Constants and Definitions ---
const SHARES = {
  // Spouse shares
  WIFE_NO_DESCENDANTS: 1 / 4, // 0.25
  HUSBAND_NO_DESCENDANTS: 1 / 2, // 0.5
  WIFE_WITH_DESCENDANTS: 1 / 8, // 0.125
  HUSBAND_WITH_DESCENDANTS: 1 / 4, // 0.25
};

// Heirs who are typically Asaba bi-nafsihi (Residuary Heirs)
const PRIMARY_ASABA = ["father", "son", "full_brother", "paternal_uncle"];

// --- Helper Functions ---

/** Checks for the presence of a son or daughter. */
const hasDescendantsFunc = (heirs) =>
  heirs.some((h) => (h.name === "son" || h.name === "daughter") && h.count > 0);

/** Finds the single, nearest Asaba (Residuary Heir) if present. (Simplified) */
const findNearestAsaba = (heirs) => {
  for (const type of PRIMARY_ASABA) {
    const heir = heirs.find((h) => h.name === type && h.count === 1);
    if (heir) return heir;
  }
  return null;
};

// --- Core Calculation Function ---

const calculateShares = async ({ assets, liabilities, heirs }) => {
  // 1. Calculate Net Estate Value
  const netEstateValue = assets - liabilities;
  if (netEstateValue < 0) {
    throw new Error(
      `The estate is insolvent. Liabilities ($${liabilities}) exceed assets ($${assets}). No inheritance is distributed.`
    );
  }

  // Filter and standardize heirs
  const survivingHeirs = heirs
    .filter((h) => h.count > 0)
    .map((h) => ({
      ...h,
      name: h.name.toLowerCase(),
      count: parseInt(h.count, 10),
    }));

  const numHeirs = survivingHeirs.length;

  const result = {
    netEstateValue,
    reconciliationStatus: "Pending",
    totalFractionAllocated: 0,
    allocatedShares: [],
    residueFraction: 0,
  };

  let totalFractionAllocated = 0;

  const spouseHeir = survivingHeirs.find(
    (h) => h.name === "wife" || h.name === "husband"
  );
  const hasDescendants = hasDescendantsFunc(survivingHeirs);
  const descendantHeirs = survivingHeirs.filter(
    (h) => h.name === "son" || h.name === "daughter"
  );

  // --- CASE 1: Sole Spouse (Fard + Radd) ---
  if (numHeirs === 1 && spouseHeir && spouseHeir.count === 1) {
    // (Logic as confirmed working in previous steps)
    const soleSpouse = spouseHeir;
    const fixedShareText = soleSpouse.name === "wife" ? "1/4" : "1/2";
    const totalFraction = 1.0;

    result.allocatedShares.push({
      heir: `${
        soleSpouse.name.charAt(0).toUpperCase() + soleSpouse.name.slice(1)
      } (${soleSpouse.count})`,
      classification: "Spouse (Fard) + Radd",
      shareFraction: totalFraction,
      shareAmount: totalFraction * netEstateValue,
      notes: `Inherits the initial fixed share of ${fixedShareText} plus the remainder (residue) via Radd (Return) because no other eligible heirs exist.`,
    });

    result.reconciliationStatus = "Radd (Return) - 100%";
    result.totalFractionAllocated = totalFraction;
    return result;
  }

  // --- CASE 3: Spouse + Descendants (Fixed Share Reduction + Ta'sib) ---
  if (spouseHeir && hasDescendants) {
    // 3a. Determine Spouse's Reduced Fixed Share (Hajib)
    let spouseFraction = 0;
    let spouseFixedShareText = "";

    if (spouseHeir.name === "husband") {
      spouseFraction = SHARES.HUSBAND_WITH_DESCENDANTS; // 1/4
      spouseFixedShareText = "1/4";
    } else if (spouseHeir.name === "wife") {
      spouseFraction = SHARES.WIFE_WITH_DESCENDANTS; // 1/8
      spouseFixedShareText = "1/8";
    }

    // Add Spouse share
    const spouseShareAmount = spouseFraction * netEstateValue;
    totalFractionAllocated += spouseFraction;

    result.allocatedShares.push({
      heir: `${
        spouseHeir.name.charAt(0).toUpperCase() + spouseHeir.name.slice(1)
      } (${spouseHeir.count})`,
      classification: "Spouse (As-hab al-Furud)",
      shareFraction: spouseFraction,
      shareAmount: spouseShareAmount,
      notes: `Fixed share reduced to ${spouseFixedShareText} due to the presence of descendants (Hajib).`,
    });

    // 3b. Residue (Ta'sib) to Descendants (2:1 ratio)
    const remainingFraction = 1.0 - totalFractionAllocated;

    if (remainingFraction > 0) {
      const numSons = survivingHeirs.find((h) => h.name === "son")?.count || 0;
      const numDaughters =
        survivingHeirs.find((h) => h.name === "daughter")?.count || 0;

      // Calculate total parts (Sons * 2 + Daughters * 1)
      const totalTaSibParts = numSons * 2 + numDaughters * 1;

      if (totalTaSibParts > 0) {
        const fractionPerPart = remainingFraction / totalTaSibParts;

        // Allocate Son's Shares
        if (numSons > 0) {
          const sonFraction = fractionPerPart * 2;
          result.allocatedShares.push({
            heir: `Son${numSons > 1 ? "s" : ""} (${numSons})`,
            classification: "Asaba bi-Ghairihi (Residue)",
            shareFraction: sonFraction * numSons, // Total fraction for all sons
            shareAmount: sonFraction * numSons * netEstateValue,
            notes: `Residue allocated with 2:1 ratio (Sons get 2 parts each). Individual share: ${sonFraction.toFixed(
              4
            )}`,
          });
        }

        // Allocate Daughter's Shares
        if (numDaughters > 0) {
          const daughterFraction = fractionPerPart * 1;
          result.allocatedShares.push({
            heir: `Daughter${numDaughters > 1 ? "s" : ""} (${numDaughters})`,
            classification: "Asaba bi-Ghairihi (Residue)",
            shareFraction: daughterFraction * numDaughters, // Total fraction for all daughters
            shareAmount: daughterFraction * numDaughters * netEstateValue,
            notes: `Residue allocated with 2:1 ratio (Daughters get 1 part each). Individual share: ${daughterFraction.toFixed(
              4
            )}`,
          });
        }

        totalFractionAllocated = 1.0; // The entire remaining fraction is allocated
      }
    }

    result.reconciliationStatus = "Complete (Fard + Ta'sib)";
    result.totalFractionAllocated = totalFractionAllocated;
    return result;
  }

  // --- CASE 2: Spouse + Single Residuary Heir (Fard + Ta'sib) ---
  const asabaHeir = findNearestAsaba(survivingHeirs);

  // Check for the combination of exactly two distinct heirs: a spouse and one single Asaba, AND no descendants.
  const isSpousePlusSingleAsaba =
    numHeirs === 2 &&
    spouseHeir &&
    asabaHeir &&
    asabaHeir.name !== spouseHeir.name && // Ensure they are different types
    asabaHeir.count === 1 &&
    !hasDescendants;

  if (isSpousePlusSingleAsaba) {
    // 2a. Determine Spouse's Fixed Share (Fard)
    const spouseFraction =
      spouseHeir.name === "wife"
        ? SHARES.WIFE_NO_DESCENDANTS
        : SHARES.HUSBAND_NO_DESCENDANTS;
    const spouseShareAmount = spouseFraction * netEstateValue;
    totalFractionAllocated += spouseFraction;

    const spouseFixedShareText = spouseHeir.name === "wife" ? "1/4" : "1/2";

    result.allocatedShares.push({
      heir: `${
        spouseHeir.name.charAt(0).toUpperCase() + spouseHeir.name.slice(1)
      } (${spouseHeir.count})`,
      classification: "Spouse (As-hab al-Furud)",
      shareFraction: spouseFraction,
      shareAmount: spouseShareAmount,
      notes: `Fixed share of ${spouseFixedShareText} due to the absence of descendants.`,
    });

    // 2b. Residue (Ta'sib) to the Asaba Heir
    const remainingFraction = 1.0 - totalFractionAllocated;
    const residueShareAmount = remainingFraction * netEstateValue;

    result.allocatedShares.push({
      heir: `${
        asabaHeir.name.charAt(0).toUpperCase() + asabaHeir.name.slice(1)
      } (${asabaHeir.count})`,
      classification: "Asaba bi-nafsihi (Residue)",
      shareFraction: remainingFraction,
      shareAmount: residueShareAmount,
      notes: `Inherits the remaining residue (Ta'sib) as the nearest male residuary heir.`,
    });

    totalFractionAllocated = 1.0; // The entire remaining fraction is allocated
    result.reconciliationStatus = "Complete (Fard + Ta'sib)";
    result.totalFractionAllocated = totalFractionAllocated;
    return result;
  }

  // --- CASE 4: Unimplemented Combinations ---
  if (numHeirs > 0) {
    throw new Error(
      `Calculation logic for this specific combination (Heirs: ${survivingHeirs
        .map((h) => `${h.count} ${h.name}`)
        .join(
          ", "
        )}) is not yet fully implemented. Supported cases: Sole Spouse, Spouse + Single Asaba, or Spouse + Descendants.`
    );
  } else {
    throw new Error("No surviving heirs provided for calculation.");
  }
};

module.exports = {
  calculateShares,
};
