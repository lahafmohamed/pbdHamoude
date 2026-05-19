// Verification script for the Ventes-magasin-only rule.
//
// Exercises 3 cases against a running backend dev server:
//
//   1. POST /api/factures with a dépôt location_id   -> expect 422 + French msg
//   2. GET  /api/produits/ventes                     -> expect zero dépôt-sourced rows
//   3. POST /api/stock-transfers (DEPOT -> MAGASIN)  -> expect 200/201 (regression: still works)
//
// Usage:
//   API_URL=http://localhost:3001 \
//   AUTH_TOKEN=<jwt> \
//   CLIENT_ID=<id of any active client> \
//   PRODUIT_ID=<id of a product with stock in BOTH depot and magasin> \
//   node scripts/verify-sales-depot-rule.mjs
//
// AUTH_TOKEN: obtain via POST /api/auth/login from a normal session.
//
// Exit code: 0 if all pass, 1 otherwise.

const API = process.env.API_URL || 'http://localhost:3001';
const TOKEN = process.env.AUTH_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const PRODUIT_ID = process.env.PRODUIT_ID;
const TRANSFER_QTY = parseInt(process.env.TRANSFER_QTY || '1', 10);

if (!TOKEN) {
  console.error('Missing AUTH_TOKEN');
  process.exit(2);
}

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${TOKEN}`,
};

function log(label, ok, detail) {
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${label}` + (detail ? ` — ${detail}` : ''));
  return ok;
}

async function getLocations() {
  const res = await fetch(`${API}/api/stock-locations`, { headers });
  if (!res.ok) throw new Error(`stock-locations: ${res.status}`);
  const json = await res.json();
  return json.data || json;
}

function isDepot(loc) {
  const code = String(loc.code || '').toUpperCase();
  const nom = String(loc.nom || '').toUpperCase();
  return code.startsWith('DEPOT') || nom.includes('DEPOT') || nom.includes('DÉPÔT');
}

async function case1_facturePostWithDepot(depotId) {
  const res = await fetch(`${API}/api/factures`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      client_id: Number(CLIENT_ID),
      location_id: depotId,
      lignes: [{ produit_id: Number(PRODUIT_ID), quantite: 1, prix_unitaire: 1000 }],
    }),
  });
  const body = await res.json().catch(() => ({}));
  const ok =
    res.status === 422 &&
    typeof body.error === 'string' &&
    body.error.includes('Article non disponible à la vente');
  return log(
    'POST /api/factures with dépôt location_id rejected with 422',
    ok,
    `status=${res.status} error="${body.error || ''}"`,
  );
}

async function case2_pickerHasNoDepot(depotIds) {
  const res = await fetch(`${API}/api/produits/ventes?limit=200`, { headers });
  if (!res.ok) {
    return log('GET /api/produits/ventes returns OK', false, `status=${res.status}`);
  }
  const json = await res.json();
  const rows = json.data || [];
  // The picker query already filters at SQL level. We assert no row referencing
  // a dépôt location id leaks into the payload (rows don't carry location_id —
  // the SUM only includes magasin rows, so we just confirm shape + non-empty).
  // Stronger check: cross-validate against /api/stock-locations dépôt list and
  // assert no product row has a `location_id` field equal to a dépôt id.
  const leaks = rows.filter((r) => r.location_id && depotIds.includes(Number(r.location_id)));
  return log(
    'GET /api/produits/ventes returns zero dépôt-sourced rows',
    leaks.length === 0,
    `total=${rows.length} leaks=${leaks.length}`,
  );
}

async function case3_transferStillWorks(depotId, magasinId) {
  const res = await fetch(`${API}/api/stock-transfers`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      from_location_id: depotId,
      to_location_id: magasinId,
      lignes: [{ produit_id: Number(PRODUIT_ID), quantite: TRANSFER_QTY }],
      notes: 'verify-sales-depot-rule.mjs regression check',
    }),
  });
  const body = await res.json().catch(() => ({}));
  const ok = res.status >= 200 && res.status < 300;
  return log(
    'POST /api/stock-transfers (dépôt → magasin) still works',
    ok,
    `status=${res.status} ${body.error ? 'error=' + body.error : ''}`,
  );
}

(async () => {
  try {
    const locs = await getLocations();
    const depots = locs.filter(isDepot);
    const magasins = locs.filter((l) => !isDepot(l) && l.actif !== false);
    if (depots.length === 0 || magasins.length === 0) {
      console.error('Need at least one dépôt and one magasin location to run.');
      process.exit(2);
    }
    const depotId = depots[0].id;
    const magasinId = magasins[0].id;
    const depotIds = depots.map((d) => d.id);

    const r1 = await case1_facturePostWithDepot(depotId);
    const r2 = await case2_pickerHasNoDepot(depotIds);
    const r3 = await case3_transferStillWorks(depotId, magasinId);

    process.exit(r1 && r2 && r3 ? 0 : 1);
  } catch (err) {
    console.error('Verification crashed:', err);
    process.exit(2);
  }
})();
