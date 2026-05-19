# 💳 Payment Tracking Feature Documentation

## Overview
Complete payment tracking system for the Magasin Informatique application. This feature allows you to record multiple payments per invoice, track payment status, and manage partial payments.

## Features Implemented

### 1. **Payment Status Tracking**
- **Status Types**:
  - `en_attente` (Unpaid) - No payments recorded
  - `partielle` (Partial) - Some payments made, balance remaining
  - `payee` (Paid) - Fully paid
  - `annulee` (Cancelled) - Invoice cancelled

- **Auto-Update**: Invoice status automatically updates based on payments:
  - 0% paid → `en_attente`
  - 1-99% paid → `partielle`
  - 100% paid → `payee`

### 2. **Payment Methods**
- 💵 **Espèces** (Cash)
- 💳 **Carte** (Card)
- 📝 **Chèque** (Check)
- 🏦 **Virement** (Bank Transfer)

### 3. **Partial Payments Support**
- Multiple payments per invoice
- Track cumulative payments
- Automatic remaining balance calculation
- Overpayment prevention

### 4. **Visual Indicators**
- Progress bar showing payment completion
- Color-coded status badges:
  - 🟢 Green: Fully paid
  - 🟡 Yellow: Partial payment
  - 🔴 Red: Unpaid or cancelled
- Paid amount and remaining balance display

## API Endpoints

### Invoice Payments
```
POST   /api/factures/:factureId/paiements     - Record a payment
GET    /api/factures/:factureId/paiements     - Get all payments for invoice
```

### Global Payments
```
GET    /api/paiements              - Get all payments (paginated)
GET    /api/paiements/stats        - Payment statistics
PUT    /api/paiements/:id          - Update a payment
DELETE /api/paiements/:id          - Delete a payment
```

## Recording a Payment

### Request Body
```json
{
  "montant": 50000,
  "methode_paiement": "espece",
  "date_paiement": "2026-04-10T14:30:00Z",  // Optional, defaults to now
  "reference": "CHK-12345",                  // Optional for cash/card, required for check/transfer
  "notes": "Premier paiement"                // Optional
}
```

### Validation Rules
- Amount must be > 0
- Amount cannot exceed remaining balance
- Cannot add payments to cancelled invoices
- Reference required for check and transfer methods

## Database Schema

### `paiements` Table
```sql
CREATE TABLE paiements (
  id SERIAL PRIMARY KEY,
  facture_id INTEGER REFERENCES factures(id) ON DELETE CASCADE,
  montant NUMERIC(10, 2) NOT NULL,
  methode_paiement VARCHAR(50) CHECK (methode_paiement IN ('espece', 'carte', 'cheque', 'virement')),
  date_paiement TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reference VARCHAR(100),
  notes TEXT,
  cree_par INTEGER,  -- For future user authentication
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `factures` Table Updates
```sql
ALTER TABLE factures 
ADD COLUMN montant_paye NUMERIC(10, 2) DEFAULT 0.00,
ADD COLUMN remaining_due NUMERIC(10, 2) DEFAULT 0.00;
```

## Triggers & Automation

### Auto-Update Trigger
When a payment is inserted or deleted, the system automatically:
1. Calculates total payments for the invoice
2. Updates `montant_paye` (amount paid)
3. Updates `remaining_due` (remaining balance)
4. Updates `statut` based on payment progress

## Frontend Components

### `PaymentStatusBar`
Shows payment progress at the top of invoice details:
- Visual progress bar
- Paid amount, remaining balance, total
- Quick "Add Payment" button
- Status badge

### `PaymentHistory`
Displays all payments for an invoice:
- Date and time
- Payment method with icon
- Amount paid
- Reference number
- Notes
- Delete button (for admin)

### `PaymentModal`
Form to record new payments:
- Amount input with "pay remaining" quick button
- Payment method selection
- Reference field
- Notes textarea
- Real-time validation
- Error handling

## Usage Examples

### 1. Record Full Payment
```javascript
await paiementService.create(factureId, {
  montant: total,
  methode_paiement: 'carte',
  notes: 'Paiement complet'
});
```

### 2. Record Partial Payment
```javascript
// First payment
await paiementService.create(factureId, {
  montant: 50000,
  methode_paiement: 'espece',
  notes: 'Premier acompte'
});

// Second payment
await paiementService.create(factureId, {
  montant: remainingDue,
  methode_paiement: 'cheque',
  reference: 'CHK-98765',
  notes: 'Paiement du solde'
});
```

### 3. Get Payment History
```javascript
const paiements = await paiementService.getByFacture(factureId);
console.log(paiements); // Array of payment objects
```

## Business Logic

### Payment Flow
1. Invoice created → Status: `en_attente`, Remaining: 100%
2. First payment recorded → Status: `partielle`, Remaining: < 100%
3. Additional payments → Status: `partielle`, Remaining: decreasing
4. Final payment → Status: `payee`, Remaining: 0

### Overpayment Prevention
```javascript
// Frontend validation
if (montant > remainingDue) {
  setError(`Maximum allowed: ${remainingDue.toFixed(2)} XOF`);
  return;
}

// Backend validation
if (montant > remainingDue) {
  res.status(400).json({ 
    error: `Le montant dépasse le reste dû. Maximum: ${remainingDue.toFixed(2)} XOF` 
  });
  return;
}
```

## Testing

### Manual Testing Steps

1. **Create Invoice**
   ```bash
   POST /api/factures
   {
     "client_id": 1,
     "lignes": [...],
     "statut": "en_attente"
   }
   ```

2. **Verify Initial Status**
   - Status should be `en_attente`
   - `montant_paye` = 0
   - `remaining_due` = total

3. **Record Partial Payment**
   ```bash
   POST /api/factures/:id/paiements
   {
     "montant": (total / 2),
     "methode_paiement": "espece"
   }
   ```

4. **Verify Status Update**
   - Status should be `partielle`
   - `montant_paye` = total / 2
   - `remaining_due` = total / 2

5. **Complete Payment**
   ```bash
   POST /api/factures/:id/paiements
   {
     "montant": (total / 2),
     "methode_paiement": "carte"
   }
   ```

6. **Verify Final Status**
   - Status should be `payee`
   - `montant_paye` = total
   - `remaining_due` = 0

## Future Enhancements

### Planned Features
- [ ] Payment receipt generation
- [ ] Bulk payment recording
- [ ] Payment schedule/recurring payments
- [ ] Late payment alerts
- [ ] Payment analytics dashboard
- [ ] Export payment reports (CSV, Excel)
- [ ] Multi-currency support
- [ ] Payment method icons in PDF
- [ ] Payment confirmation emails
- [ ] User authentication integration (cree_par field)

## Migration

### Running the Migration
```bash
cd backend
node migrate-paiements.mjs
```

### What the Migration Does
1. Creates `paiements` table
2. Adds indexes for performance
3. Adds `montant_paye` and `remaining_due` columns to `factures`
4. Updates status constraint to include `partielle`
5. Creates auto-update triggers
6. Backfills existing invoices

### Rollback (if needed)
```sql
DROP TRIGGER IF EXISTS trg_after_payment_insert ON paiements;
DROP TRIGGER IF EXISTS trg_after_payment_delete ON paiements;
DROP FUNCTION IF EXISTS update_facture_payment_status();
DROP FUNCTION IF EXISTS update_facture_on_payment_delete();
DROP TABLE IF EXISTS paiements;
ALTER TABLE factures DROP COLUMN IF EXISTS montant_paye;
ALTER TABLE factures DROP COLUMN IF EXISTS remaining_due;
```

## Troubleshooting

### Common Issues

**Issue**: "Le montant dépasse le reste dû"
- **Solution**: Check remaining balance before submitting. Use the "pay remaining" button for full payment.

**Issue**: Invoice status not updating
- **Solution**: Verify database triggers are created. Re-run migration if needed.

**Issue**: Payment not showing in UI
- **Solution**: Refresh the page. Check browser console for errors. Verify API response.

## Support

For questions or issues, please refer to:
- Main project README
- API documentation
- Database schema documentation

---

**Version**: 1.0.0  
**Last Updated**: April 10, 2026  
**Author**: ERP Expert Team
