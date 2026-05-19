# API Documentation - Role-Based Stock Management

## Authentication

All endpoints require JWT authentication via `Authorization: Bearer <token>` header.

---

## Demandes de Réapprovisionnement

### List Demandes
```http
GET /api/demandes?statut=envoyee&limit=20&offset=0
```

**Query Parameters:**
- `statut` (optional): Filter by status (`brouillon`, `envoyee`, `approuvee`, `partiellement_approuvee`, `refusee`, `en_cours`, `livree`, `cloturee`)
- `limit` (optional): Number of results (default: 20)
- `offset` (optional): Pagination offset (default: 0)

**Role-based Filtering:**
- `magasin_staff`: Sees only demandes created by their magasin
- `depot_staff`: Sees demandes targeting their depot
- `admin`: Sees all demandes

**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "numero": "DEM-20240105-001",
      "statut": "envoyee",
      "magasin_nom": "Magasin Principal",
      "magasin_code": "MAG01",
      "depot_nom": "Dépôt Central",
      "depot_code": "DEP01",
      "created_by_nom": "Jean Dupont",
      "date_creation": "2024-01-05T10:30:00Z",
      "date_envoi": "2024-01-05T10:35:00Z",
      "date_decision": null,
      "date_execution": null,
      "date_livraison": null,
      "numero_transfer": null
    }
  ]
}
```

---

### Get Demande by ID
```http
GET /api/demandes/:id
```

**Response:**
```json
{
  "id": 1,
  "numero": "DEM-20240105-001",
  "statut": "envoyee",
  "magasin_id": 1,
  "magasin_nom": "Magasin Principal",
  "magasin_code": "MAG01",
  "depot_id": 2,
  "depot_nom": "Dépôt Central",
  "depot_code": "DEP01",
  "created_by_user_id": 3,
  "created_by_nom": "Jean Dupont",
  "decided_by_nom": null,
  "executed_by_nom": null,
  "closed_by_nom": null,
  "date_creation": "2024-01-05T10:30:00Z",
  "date_envoi": "2024-01-05T10:35:00Z",
  "date_decision": null,
  "date_execution": null,
  "date_livraison": null,
  "date_cloture": null,
  "motif": "Réapprovisionnement hebdomadaire",
  "raison_refus": null,
  "numero_transfer": null,
  "transfert_id": null,
  "lignes": [
    {
      "id": 1,
      "produit_id": 5,
      "produit_nom": "Produit A",
      "reference": "REF-001",
      "quantite_demandee": 100,
      "quantite_approuvee": null,
      "quantite_livree": null,
      "notes": "Urgent"
    }
  ],
  "historique": [
    {
      "id": 1,
      "from_statut": null,
      "to_statut": "brouillon",
      "timestamp": "2024-01-05T10:30:00Z",
      "username": "jdupont",
      "nom_complet": "Jean Dupont",
      "payload": null
    },
    {
      "id": 2,
      "from_statut": "brouillon",
      "to_statut": "envoyee",
      "timestamp": "2024-01-05T10:35:00Z",
      "username": "jdupont",
      "nom_complet": "Jean Dupont",
      "payload": null
    }
  ]
}
```

---

### Create Demande
```http
POST /api/demandes
```

**Request Body:**
```json
{
  "magasin_id": 1,
  "depot_id": 2,
  "motif": "Réapprovisionnement hebdomadaire",
  "lignes": [
    {
      "produit_id": 5,
      "quantite_demandee": 100,
      "notes": "Urgent"
    }
  ]
}
```

**Permissions Required:** `DEMANDE_CREATE`

**Response:**
```json
{
  "id": 1,
  "numero": "DEM-20240105-001",
  "statut": "brouillon",
  ...
}
```

---

### Update Demande (Brouillon only)
```http
PUT /api/demandes/:id
```

**Request Body:**
```json
{
  "motif": "Mise à jour du motif",
  "lignes": [
    {
      "produit_id": 5,
      "quantite_demandee": 150,
      "notes": "Très urgent"
    }
  ]
}
```

**Permissions Required:** `DEMANDE_UPDATE` (must be owner or admin)
**State Constraint:** Only `brouillon` demandes can be updated

---

### Send Demande (Brouillon → Envoyée)
```http
POST /api/demandes/:id/envoyer
```

**Permissions Required:** `DEMANDE_SEND`
**State Transition:** `brouillon` → `envoyee`

**Response:**
```json
{
  "message": "Demande envoyée au dépôt",
  "demande": { ... }
}
```

---

### Decide on Demande (Depot Approval/Rejection)
```http
POST /api/demandes/:id/decider
```

**Request Body:**
```json
{
  "decision": "approuvee",
  "lignes_decision": [
    {
      "ligne_id": 1,
      "quantite_approuvee": 100
    }
  ]
}
```

**Or for rejection:**
```json
{
  "decision": "refusee",
  "raison_refus": "Stock insuffisant"
}
```

**Permissions Required:** `DEMANDE_DECIDE`
**State Transition:** `envoyee` → `approuvee` | `partiellement_approuvee` | `refusee`

**Response:**
```json
{
  "message": "Demande approuvée",
  "demande": { ... },
  "resulting_status": "approuvee"
}
```

---

### Execute Demande (Create Transfer + Move Stock)
```http
POST /api/demandes/:id/executer
```

**Permissions Required:** `DEMANDE_EXECUTE`
**State Transition:** `approuvee` | `partiellement_approuvee` → `en_cours` → `livree`

**Atomic Operation:**
1. Creates `stock_transfers` record
2. Moves stock from depot to magasin (with locking)
3. Updates `demandes_reapprovisionnement` status
4. Creates audit log entry

**Response:**
```json
{
  "message": "Transfert exécuté avec succès",
  "demande": { ... },
  "transfer": {
    "id": 10,
    "numero_transfer": "TRF-20240105-001"
  }
}
```

---

### Close Demande (Confirm Receipt)
```http
POST /api/demandes/:id/cloturer
```

**Permissions Required:** `DEMANDE_CLOSE`
**State Transition:** `livree` → `cloturee`

**Response:**
```json
{
  "message": "Demande clôturée",
  "demande": { ... }
}
```

---

### Cancel Demande
```http
POST /api/demandes/:id/annuler
```

**Permissions Required:** `DEMANDE_CANCEL` (must be owner or admin)
**State Constraint:** Only `brouillon` or `envoyee` demandes can be cancelled

**Response:**
```json
{
  "message": "Demande annulée",
  "demande": { ... }
}
```

---

### Get Depot Stock (for Planning)
```http
GET /api/demandes/stock/depot?depot_id=2&search=produit
```

**Query Parameters:**
- `depot_id` (required): Depot location ID
- `search` (optional): Filter by product name/reference

**Permissions Required:** `STOCK_DEPOT_VIEW`

**Response:**
```json
{
  "data": [
    {
      "produit_id": 5,
      "reference": "REF-001",
      "produit_nom": "Produit A",
      "prix_vente": "1500.00",
      "quantite_disponible": 250
    }
  ]
}
```

---

## Stock Transfers

### List Transfers
```http
GET /api/stock-transfers
```

**Response:**
```json
{
  "data": [
    {
      "id": 10,
      "numero_transfer": "TRF-20240105-001",
      "source_nom": "Dépôt Central",
      "destination_nom": "Magasin Principal",
      "date_transfer": "2024-01-05T11:00:00Z",
      "statut": "completee",
      "demande_id": 1,
      "demande_numero": "DEM-20240105-001"
    }
  ]
}
```

---

### Create Proactive Transfer
```http
POST /api/stock-transfers
```

**Request Body:**
```json
{
  "location_source_id": 2,
  "location_destination_id": 1,
  "notes": "Transfert proactif",
  "lignes": [
    {
      "produit_id": 5,
      "quantite_demandee": 50
    }
  ]
}
```

**Permissions Required:** `TRANSFERT_CREATE` or `TRANSFERT_CREATE_PROACTIVE`

---

### Complete Transfer
```http
POST /api/stock-transfers/:id/complete
```

**Permissions Required:** `TRANSFERT_EXECUTE`

---

## Permissions Reference

| Permission | Role(s) | Description |
|------------|---------|-------------|
| `STOCK_DEPOT_VIEW` | admin, depot_staff, manager, magasin_staff, viewer | View depot stock |
| `STOCK_DEPOT_WRITE` | admin, depot_staff, manager | Modify depot stock |
| `STOCK_MAGASIN_VIEW` | admin, depot_staff, manager, magasin_staff, caissier, viewer | View magasin stock |
| `STOCK_MAGASIN_WRITE` | admin, manager, magasin_staff, caissier | Modify magasin stock |
| `DEMANDE_CREATE` | admin, magasin_staff, caissier | Create demande (brouillon) |
| `DEMANDE_READ` | all authenticated | View demandes |
| `DEMANDE_UPDATE` | admin, magasin_staff (own), caissier (own) | Edit brouillon demande |
| `DEMANDE_SEND` | admin, magasin_staff (own), caissier (own) | Submit to depot |
| `DEMANDE_DECIDE` | admin, depot_staff | Approve/reject demande |
| `DEMANDE_EXECUTE` | admin, depot_staff | Execute transfer from depot |
| `DEMANDE_CLOSE` | admin, magasin_staff (own), caissier (own) | Confirm receipt |
| `DEMANDE_CANCEL` | admin, magasin_staff (own), caissier (own) | Cancel brouillon/envoyee |
| `TRANSFERT_CREATE` | admin, manager | Create any transfer |
| `TRANSFERT_CREATE_PROACTIVE` | admin, depot_staff | Create proactive depot→magasin |
| `TRANSFERT_EXECUTE` | admin, depot_staff, manager | Complete transfers |

---

## State Machine

```
brouillon ──[send]──> envoyee ──[decide:approve]──> approuvee ──[execute]──> en_cours ──[stock moved]──> livree ──[close]──> cloturee
                                      │                  │
                                      └──[decide:partial]──┘                  │
                                      │                                       │
                                      └──[decide:reject]──────────────────────┘
                                                              (ends here - no transfer)
```

**Cancel:** Can cancel from `brouillon` or `envoyee` states.

---

## Error Responses

### Permission Denied (403)
```json
{
  "error": "Permission refusée: demande:decide requise"
}
```

### Invalid State Transition (400)
```json
{
  "error": "Transition non autorisée depuis le statut 'livree'"
}
```

### Not Found (404)
```json
{
  "error": "Demande introuvable"
}
```

### Insufficient Stock (409)
```json
{
  "error": "Stock insuffisant pour le produit REF-001 (demandé: 100, disponible: 50)"
}
```

---

## Testing with cURL

### Login
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"magasin1","password":"magasin123"}'
```

### Create Demande
```bash
curl -X POST http://localhost:3001/api/demandes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "magasin_id": 1,
    "depot_id": 2,
    "lignes": [{"produit_id": 5, "quantite_demandee": 100}]
  }'
```

### Send Demande
```bash
curl -X POST http://localhost:3001/api/demandes/1/envoyer \
  -H "Authorization: Bearer $TOKEN"
```

### Approve Demande (as depot)
```bash
curl -X POST http://localhost:3001/api/demandes/1/decider \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "decision": "approuvee",
    "lignes_decision": [{"ligne_id": 1, "quantite_approuvee": 100}]
  }'
```

### Execute Demande (as depot)
```bash
curl -X POST http://localhost:3001/api/demandes/1/executer \
  -H "Authorization: Bearer $TOKEN"
```

---

**END OF API DOCUMENTATION**
