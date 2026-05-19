export interface PricingLigneInput {
  quantite: number;
  prix_unitaire: number;
  remise_pct?: number;
  remise_montant?: number;
}

export interface PricingTotals {
  sousTotal: number;
  remiseGlobale: number;
  remiseGlobalePct: number;
  total: number;
  totalLignes: number[];
}

/**
 * Calculate totals for a sales document (facture, devis, BL, avoir).
 *
 * @param lignes   Line items with quantite and prix_unitaire
 * @param remise_globale    Optional global discount amount
 * @param remise_globale_pct Optional global discount percentage
 * @returns PricingTotals with sousTotal, remise, and total
 */
export function calculateTotals(
  lignes: PricingLigneInput[],
  remise_globale?: number,
  remise_globale_pct?: number
): PricingTotals {
  let sousTotal = 0;
  const totalLignes: number[] = [];

  for (const ligne of lignes) {
    let ligneTotal = ligne.quantite * ligne.prix_unitaire;

    // Apply per-line discount if provided
    if (ligne.remise_pct && ligne.remise_pct > 0) {
      ligneTotal -= ligneTotal * (ligne.remise_pct / 100);
    }
    if (ligne.remise_montant && ligne.remise_montant > 0) {
      ligneTotal -= ligne.remise_montant;
    }

    // Ensure non-negative per line
    ligneTotal = Math.max(0, ligneTotal);
    totalLignes.push(ligneTotal);
    sousTotal += ligneTotal;
  }

  // Apply global discount
  let remiseGlobalePct = remise_globale_pct || 0;
  let remiseGlobale = remise_globale || 0;

  if (remiseGlobalePct > 0) {
    remiseGlobale = sousTotal * (remiseGlobalePct / 100);
  }

  remiseGlobale = Math.min(remiseGlobale, sousTotal); // Cap at sousTotal
  const total = Math.max(0, sousTotal - remiseGlobale);

  return {
    sousTotal: parseFloat(sousTotal.toFixed(2)),
    remiseGlobale: parseFloat(remiseGlobale.toFixed(2)),
    remiseGlobalePct: parseFloat(remiseGlobalePct.toFixed(2)),
    total: parseFloat(total.toFixed(2)),
    totalLignes,
  };
}
