# FIFO Allocation System

## Overview

This system implements FIFO (First-In, First-Out) payment allocation for invoices, fixing the inconsistency between global client balance and per-invoice payment statuses.

## Problem Solved

**Before:** Payments were manually tied to specific invoices, creating inconsistencies where:
- Global balance showed "Compte soldé" 
- But some invoices still displayed "En attente" status
- Overpayments occurred on some invoices while others remained unpaid

**After:** Payments are automatically allocated to the oldest unpaid invoices first, ensuring:
- Consistent global balance and invoice statuses
- No overpayments on individual invoices
- Clear visibility of allocation progress

## Architecture

### Backend Components

1. **ClientAllocationService** - Core FIFO allocation engine
2. **AdminAllocationController** - Admin endpoints for recompute/backfill
3. **Updated Controllers** - Payment and invoice mutations trigger reallocation
4. **Database Schema** - New indexes and audit tables

### Frontend Components

1. **Factures List** - FIFO tooltip and "Partiellement payée" status
2. **Client Account Modal** - Surplus display and per-invoice progress bars
3. **StatusBadge** - Updated to support "partielle" status

## API Endpoints

### Admin Allocation Routes
- `POST /api/admin/allocation/recompute-all` - Recompute all clients (admin only)
- `GET /api/admin/allocation/test/:clientId` - Test allocation (dry run)
- `POST /api/admin/allocation/recompute/:clientId` - Recompute specific client

### Existing Endpoints (Updated)
- All payment mutations now trigger FIFO reallocation
- All invoice mutations now trigger FIFO reallocation
- Client compte endpoint includes allocation data

## Migration & Rollout

### Step 1: Run Migration
```bash
cd backend
node scripts/run_fifo_migration.js migrate
```

### Step 2: Verify Results
- Check client account pages for correct allocation
- Verify factures list shows proper status
- Test new payment creation

### Step 3: Monitor
- Watch for allocation inconsistencies
- Monitor performance with new indexes

### Rollback (if needed)
```bash
node scripts/run_fifo_migration.js rollback
```

## Allocation Rules

### FIFO Logic
1. Sort payments by date ASC (oldest first)
2. Sort invoices by date ASC (oldest first) 
3. Allocate each payment to the oldest unpaid invoice
4. Continue until payment is exhausted or all invoices are paid

### Status Rules
- `montant_paye = 0` → "En attente"
- `0 < montant_paye < total` → "Partiellement payée" 
- `montant_paye >= total` → "Payée"
- Annulée invoices never receive allocation

### Date Constraints
- Payments only allocate to invoices dated ≤ payment date
- Future invoices cannot be prepaid
- Surplus remains unallocated for future invoices

## Testing

### Test with Dupont Jean Data
The migration includes test data for client Dupont Jean showing:
- Before: Manual allocation with overpayments and unpaid invoices
- After: Proper FIFO allocation with consistent statuses

### Manual Testing
1. Create a new payment for a client with multiple invoices
2. Verify oldest invoice gets paid first
3. Check client account modal for progress bars
4. Verify surplus calculation

## Performance Considerations

### Database Indexes
- `idx_factures_client_date` - Optimizes client invoice queries
- `idx_paiements_date` - Optimizes payment date sorting

### Transaction Safety
- All allocations run in transactions with `SELECT FOR UPDATE`
- Prevents concurrent allocation conflicts
- Automatic rollback on errors

### Audit Trail
- `allocation_audit` table tracks all allocation changes
- Records before/after states for debugging
- Supports compliance requirements

## Troubleshooting

### Common Issues

1. **Inconsistent allocations after migration**
   - Run: `SELECT * FROM check_allocation_consistency();`
   - Use admin endpoint to recompute affected clients

2. **Performance issues with large datasets**
   - Ensure indexes are created
   - Consider batching recompute operations

3. **Frontend not showing allocation data**
   - Verify API responses include `total_alloue` and `surplus`
   - Check browser console for JavaScript errors

### Debug Queries

```sql
-- Check allocation consistency for specific client
SELECT * FROM check_allocation_consistency(3);

-- View allocation audit trail
SELECT * FROM allocation_audit WHERE client_id = 3 ORDER BY created_at DESC;

-- Check allocation version
SELECT client_id, allocation_version, COUNT(*) 
FROM factures 
GROUP BY client_id, allocation_version;
```

## Future Enhancements

1. **Allocation Rules Engine** - Configurable allocation strategies
2. **Partial Payment Handling** - Support for payment installments
3. **Allocation Notifications** - Alert users when allocation changes
4. **Historical Allocation Views** - Track allocation over time
5. **Bulk Allocation Operations** - Admin tools for bulk corrections

## Support

For issues or questions about the FIFO allocation system:
1. Check this README first
2. Review allocation audit logs
3. Use admin test endpoints for debugging
4. Contact development team with specific error details
