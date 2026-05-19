# Inventaires Module Audit Report
## Role-Based Access Control Implementation

**Date:** 2026-01-05  
**Scope:** Identify existing inventory/stock pages, components, endpoints for KEEP/MIGRATE/DELETE/AUDIT classification

---

## Executive Summary

| Category | KEEP | MIGRATE | DELETE | AUDIT |
|----------|------|---------|--------|-------|
| Frontend Pages | 3 | 1 | 2 | 0 |
| Frontend Components | 3 | 0 | 0 | 0 |
| Backend Routes | 2 | 0 | 1 | 0 |
| Backend Controllers | 2 | 1 | 1 | 0 |
| Database Tables | 3 | 0 | 2* | 0 |

*Archive rather than hard delete for data preservation

---

## Frontend Pages

### 1. `src/pages/Inventaire.tsx` (1080 lines)
| Attribute | Value |
|-----------|-------|
| **Purpose** | Main product management: CRUD produits, stock adjustment per location, bulk operations, export CSV, stock history |
| **Used by** | All roles (with location-based filtering) |
| **Key Features** | - Location selector for stock view<br>- Quick quantity adjust (QuickQuantityAdjust component)<br>- Inline editing (InlineEdit component)<br>- Bulk operations (delete, category change, stock adjust)<br>- Stock movement history modal |
| **Classification** | **KEEP** |
| **Reasoning** | Core product management is still required. The new RBC model adds role restrictions but doesn't replace product catalog management. |
| **Changes Required** | - Add role-based gating on stock adjustment (depot_staff can adjust depot stock, magasin_staff can adjust magasin stock)<br>- Read-only banner for cross-location viewing |
| **Deletion Risk** | None - actively used by all workflows |

---

### 2. `src/pages/StockLocations.tsx` (9371 chars)
| Attribute | Value |
|-----------|-------|
| **Purpose** | Manage stock locations (depots/magasins): create, edit, view locations |
| **Used by** | Admin, manager roles |
| **Classification** | **KEEP** |
| **Reasoning** | Location management is still required. The `location_type` discriminator (depot/magasin) was added via migration. |
| **Changes Required** | None - admin-only page already restricted |
| **Deletion Risk** | Low - referenced by location management workflow |

---

### 3. `src/pages/StockTransfers.tsx` (520 lines)
| Attribute | Value |
|-----------|-------|
| **Purpose** | List and create inter-location transfers, complete transfers |
| **Used by** | Admin, manager (legacy roles) |
| **Classification** | **MIGRATE** |
| **Reasoning** | The proactive transfer flow (depot→magasin without prior demande) still uses this. Should be updated with:<br>- Role gating (depot_staff can create proactive transfers)<br>- Link to demande when transfer is demande-initiated |
| **Migration Path** | Enhance with `requirePermission(TRANSFERT_CREATE_PROACTIVE)` and show `demande_id` when linked |
| **Deletion Risk** | Medium - linked from Navbar, used for proactive transfers |

---

### 4. `src/pages/StockValuation.tsx` (9110 chars)
| Attribute | Value |
|-----------|-------|
| **Purpose** | Stock valuation reports, inventory valuation by location |
| **Used by** | Admin, manager, finance |
| **Classification** | **KEEP** |
| **Reasoning** | Reporting is still relevant and not replaced by RBC model. |
| **Changes Required** | None - read-only reporting |
| **Deletion Risk** | Low - finance/reporting dependency |

---

### 5. `src/pages/MagasinInternalRequests.tsx` (523 lines)
| Attribute | Value |
|-----------|-------|
| **Purpose** | OLD: Magasin creates requests to depot, cart-style product selection, view request history |
| **Used by** | Magasin staff (legacy) |
| **Classification** | **DELETE** |
| **Reasoning** | Superseded by new `DemandesList` + `DemandeForm` pages with proper state machine (`brouillon`→`envoyee`→`approuvee`→`livree`→`cloturee`). Old flow only had `en_attente`→`validee`→`executee`. |
| **Deletion Risk** | Low - new pages provide equivalent + enhanced functionality |
| **Migration Path** | Remove route from App.tsx, remove from Navbar after transition period |

---

### 6. `src/pages/DepotInternalRequests.tsx` (582 lines)
| Attribute | Value |
|-----------|-------|
| **Purpose** | OLD: Depot validates/rejects/executes incoming requests from magasins |
| **Used by** | Depot staff (legacy) |
| **Classification** | **DELETE** |
| **Reasoning** | Superseded by new `DemandeDetail` page with decision dialog supporting partial approval (`partiellement_approuvee` state) and proper role-based access. |
| **Deletion Risk** | Low - new page provides equivalent + enhanced functionality |
| **Migration Path** | Remove route from App.tsx, remove from Navbar after transition period |

---

### 7. `src/pages/AffectationsLocations.tsx` (9270 chars)
| Attribute | Value |
|-----------|-------|
| **Purpose** | Assign users to locations (user_location_assignments) |
| **Used by** | Admin |
| **Classification** | **KEEP** |
| **Reasoning** | Still needed for user-location mapping. New `user_location_roles` table extends this. |
| **Changes Required** | Update to use new `user_location_roles` with `role_at_location` column |
| **Deletion Risk** | Medium - admin workflow dependency |

---

## Frontend Components

### 1. `src/components/ui/quick-quantity-adjust.tsx`
| Classification | **KEEP** |
| Reasoning | Reusable component for quick stock adjustment, used by Inventaire.tsx |
| Changes | None |

### 2. `src/components/ui/inline-edit.tsx`
| Classification | **KEEP** |
| Reasoning | Reusable inline editing component, used by Inventaire.tsx for product fields |
| Changes | None |

### 3. `src/components/ui/status-badge.tsx`
| Classification | **KEEP** |
| Reasoning | Generic status badge component, used across multiple pages |
| Changes | Add new status variants for demande states |

---

## Backend Routes

### 1. `src/routes/internal-stock-requests.ts`
| Attribute | Value |
|-----------|-------|
| **Endpoints** | `GET /`, `GET /:id`, `POST /`, `POST /:id/validate`, `POST /:id/reject`, `POST /:id/execute` |
| **Controller** | `InternalStockRequestController` |
| **Classification** | **DELETE** |
| **Reasoning** | Superseded by `/api/demandes` routes with full state machine. Old states: `en_attente`→`validee`→`executee`. New states: `brouillon`→`envoyee`→`approuvee`/`partiellement_approuvee`/`refusee`→`en_cours`→`livree`→`cloturee`. |
| **Deletion Risk** | Low - new routes provide superset of functionality |
| **Migration Path** | Remove import and registration from `server.ts` after confirming data migration |

---

### 2. `src/routes/stock-transfers.ts`
| Attribute | Value |
|-----------|-------|
| **Endpoints** | `GET /`, `GET /:id`, `POST /`, `POST /:id/complete` |
| **Controller** | `StockTransferController` |
| **Classification** | **KEEP** |
| **Reasoning** | Still needed for proactive transfers (depot→magasin without prior demande). Extended with `demande_id` FK for demande-initiated transfers. |
| **Changes Required** | Add role gating middleware: `requirePermission(TRANSFERT_CREATE_PROACTIVE)` for POST, `requirePermission(TRANSFERT_EXECUTE)` for complete |
| **Deletion Risk** | High - core transfer functionality |

---

### 3. `src/routes/stock-locations.ts`
| Attribute | Value |
|-----------|-------|
| **Endpoints** | `GET /`, `GET /:id`, `POST /`, `GET /:id/stock`, `GET /:id/products-with-stock` |
| **Classification** | **KEEP** |
| **Reasoning** | Core location management, used by all stock workflows |
| **Changes** | None |
| **Deletion Risk** | High - core functionality |

---

### 4. `src/routes/demandes.ts` (NEW)
| Attribute | Value |
|-----------|-------|
| **Endpoints** | `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `POST /:id/envoyer`, `POST /:id/decider`, `POST /:id/executer`, `POST /:id/cloturer`, `POST /:id/annuler`, `GET /stock/depot` |
| **Classification** | **KEEP** |
| **Reasoning** | This is the new RBC workflow implementation |
| **Deletion Risk** | None - this is the replacement |

---

## Backend Controllers & Services

### 1. `InternalStockRequestController.ts` + `InternalStockRequestService.ts` (641 lines)
| Classification | **DELETE** (after migration confirmation) |
| Reasoning | Superseded by `DemandeController` + `DemandeService` |
| Migration Path | Archive files to `_deprecated/` folder or delete after data migration verified |
| Data Migration | Migration `041_demandes_reapprovisionnement.sql` copies data from `internal_stock_requests` → `demandes_reapprovisionnement` |

---

### 2. `StockTransferController.ts` + `StockTransferService.ts` (292 lines)
| Classification | **KEEP** |
| Reasoning | Still needed for transfer execution. Integration point with `DemandeService.execute()` which creates transfers. |
| Changes | Add permission checks for proactive transfer creation |

---

### 3. `StockLocationController.ts` + `StockLocationService.ts`
| Classification | **KEEP** |
| Reasoning | Core location and stock level queries |
| Changes | None |

---

### 4. `DemandeController.ts` (NEW) + `DemandeService.ts` (NEW)
| Classification | **KEEP** |
| Reasoning | New RBC workflow implementation with full state machine |
| Integration | Uses `StockTransferService` for actual stock movement during `execute()` |

---

## Database Tables

### To Keep (Core Infrastructure)
| Table | Purpose |
|-------|---------|
| `stock_locations` | Location master data with `location_type` discriminator |
| `stock_par_location` | Per-location stock quantities |
| `stock_transfers` | Transfer records, extended with `demande_id` |
| `stock_transfer_lignes` | Transfer line items, extended with `demande_ligne_id` |
| `demandes_reapprovisionnement` | NEW: Full state machine demande header |
| `demandes_reapprovisionnement_lignes` | NEW: Demande line items with requested/approved/delivered quantities |
| `demandes_reapprovisionnement_history` | NEW: Audit trail of state transitions |
| `user_location_roles` | NEW: Canonical user-location-role assignments |

### To Archive (Soft Deprecation)
| Table | Action | Migration |
|-------|--------|-----------|
| `internal_stock_requests` | Rename to `_deprecated_internal_stock_requests` | Data migrated to `demandes_reapprovisionnement` in migration `041` |
| `internal_stock_request_lignes` | Rename to `_deprecated_internal_stock_request_lignes` | Data migrated to `demandes_reapprovisionnement_lignes` |

**Rationale for archive vs delete:** Preserves historical data for audit purposes. Can be removed after 90-day confirmation period.

---

## Deletion Plan (Execution Checklist)

### Phase 1: Verification (Immediate)
- [ ] Run migrations `040`, `041`, `042` in dev environment
- [ ] Verify data migration: compare `internal_stock_requests` count vs `demandes_reapprovisionnement` count
- [ ] Test new workflow: create demande → send → approve → execute → close
- [ ] Verify old and new pages show consistent data

### Phase 2: Soft Deprecation (Week 1-2)
- [ ] Mark old Navbar items as "(Legacy)" (already done in Navbar.tsx)
- [ ] Announce transition to users
- [ ] Monitor error logs on `/api/internal-stock-requests` endpoints

### Phase 3: Frontend Cleanup (Week 3)
- [ ] Remove routes from `App.tsx`:
  - `/stock-demandes-magasin` → `MagasinInternalRequests`
  - `/stock-demandes-depot` → `DepotInternalRequests`
- [ ] Remove Navbar entries for legacy pages
- [ ] Archive page files to `src/pages/_deprecated/`:
  - `MagasinInternalRequests.tsx`
  - `DepotInternalRequests.tsx`

### Phase 4: Backend Cleanup (Week 4)
- [ ] Remove from `server.ts`:
  - Import `internalStockRequestsRoutes`
  - Route registration `app.use('/api/internal-stock-requests', ...)`
- [ ] Archive route file: `src/routes/internal-stock-requests.ts`
- [ ] Archive controller: `src/controllers/InternalStockRequestController.ts`
- [ ] Archive service: `src/services/InternalStockRequestService.ts`

### Phase 5: Database Archive (Week 5)
```sql
-- Execute after 30-day stabilization period
ALTER TABLE internal_stock_requests RENAME TO _deprecated_internal_stock_requests;
ALTER TABLE internal_stock_request_lignes RENAME TO _deprecated_internal_stock_request_lignes;
DROP TRIGGER IF EXISTS update_internal_stock_requests_updated_at ON _deprecated_internal_stock_requests;
DROP TRIGGER IF EXISTS update_internal_stock_request_lignes_updated_at ON _deprecated_internal_stock_request_lignes;
```

### Phase 6: Final Cleanup (Month 2+)
- [ ] Drop deprecated tables after 90-day retention
- [ ] Remove archived code files from repository

---

## Risk Assessment

| Item | Risk Level | Mitigation |
|------|------------|------------|
| Data loss during migration | LOW | Migration `041` uses `ON CONFLICT DO NOTHING`, preserving existing data. Archive tables before dropping. |
| Users accessing old URLs | LOW | Old routes removed from Navbar and App.tsx. Redirect old routes to new `/demandes` page. |
| Partial approval not in old data | MEDIUM | Migration maps `validee` → `approuvee`. Historical partial approvals (none in old schema) start fresh. |
| StockTransfer integration | LOW | `DemandeService.execute()` calls same `stock_transfers` table. No breaking changes. |

---

## Migration Verification Queries

```sql
-- Verify data migration count
SELECT 
  (SELECT COUNT(*) FROM internal_stock_requests) as old_count,
  (SELECT COUNT(*) FROM demandes_reapprovisionnement WHERE numero LIKE 'DEM-MIGRATED-%') as migrated_count;

-- Check for orphaned transfer links
SELECT * FROM internal_stock_requests 
WHERE transfer_id IS NOT NULL 
AND NOT EXISTS (SELECT 1 FROM stock_transfers WHERE id = transfer_id);

-- Verify new demande states
SELECT statut, COUNT(*) FROM demandes_reapprovisionnement GROUP BY statut;
```

---

## Summary

The new RBC model **supersedes** the old `internal_stock_requests` workflow but **preserves and enhances** the core inventory management (`Inventaire.tsx`), location management (`StockLocations.tsx`), and transfer infrastructure (`StockTransfers.tsx` + tables).

**Key architectural improvement:** The old model mixed request workflow with transfer execution in one table. The new model separates concerns:
- `demandes_reapprovisionnement` = business workflow (request/approval/delivery/confirmation)
- `stock_transfers` = physical stock movement execution

This enables partial approvals, cancellation, and clear audit trails while maintaining data integrity through the migration.

---

**END OF AUDIT REPORT**
