const pool = require('../dist/db/connection.js').default;
const { ClientAllocationService } = require('../dist/services/ClientAllocationService.js');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Starting FIFO Allocation Migration...\n');
    
    // Step 1: Run SQL migration
    console.log('1️⃣ Running SQL migration...');
    const migrationSQL = fs.readFileSync(
      path.join(__dirname, '../migrations/001_fifo_allocation.sql'), 
      'utf8'
    );
    
    await client.query('BEGIN');
    await client.query(migrationSQL);
    await client.query('COMMIT');
    console.log('✅ SQL migration completed\n');
    
    // Step 2: Run backfill for all clients
    console.log('2️⃣ Running FIFO backfill for all clients...');
    const backfillStart = Date.now();
    const backfillResult = await ClientAllocationService.recomputeAllAllocations();
    const backfillTime = Date.now() - backfillStart;
    
    console.log('✅ FIFO backfill completed');
    console.log(`   - Clients processed: ${backfillResult.clientsProcessed}`);
    console.log(`   - Factures updated: ${backfillResult.facturesUpdated}`);
    console.log(`   - Time elapsed: ${backfillTime}ms\n`);
    
    // Step 3: Verify consistency
    console.log('3️⃣ Verifying allocation consistency...');
    const consistencyCheck = await client.query('SELECT * FROM check_allocation_consistency()');
    
    let inconsistentClients = 0;
    consistencyCheck.rows.forEach(row => {
      if (row.inconsistent_factures > 0) {
        inconsistentClients++;
        console.log(`⚠️  Client ${row.client_id}: ${row.inconsistent_factures} inconsistent factures`);
      }
    });
    
    if (inconsistentClients === 0) {
      console.log('✅ All allocations are consistent\n');
    } else {
      console.log(`⚠️  ${inconsistentClients} clients have inconsistent allocations\n`);
    }
    
    // Step 4: Show sample results
    console.log('4️⃣ Sample allocation results (first 5 clients):');
    backfillResult.summary.slice(0, 5).forEach(result => {
      console.log(`   Client ${result.clientId}:`);
      console.log(`     - Factures updated: ${result.facturesUpdated}`);
      console.log(`     - Total pool: ${result.totalPool} FCFA`);
      console.log(`     - Total allocated: ${result.totalAllocated} FCFA`);
      console.log(`     - Surplus: ${result.surplus} FCFA`);
    });
    
    console.log('\n🎉 FIFO Allocation Migration completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('   1. Test the allocation system with real payments');
    console.log('   2. Verify frontend displays correct allocation info');
    console.log('   3. Monitor for any inconsistencies');
    console.log('   4. Use rollback function if needed: SELECT rollback_fifo_allocation();');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

async function rollbackMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Rolling back FIFO Allocation Migration...\n');
    
    const rollbackResult = await client.query('SELECT rollback_fifo_allocation() as message');
    console.log('✅', rollbackResult.rows[0].message);
    
    console.log('\n🔄 Rollback completed!');
    console.log('   The allocation logic has been reset to version 0.');
    console.log('   Manual payment allocation is now active again.');
    
  } catch (error) {
    console.error('❌ Rollback failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Main execution
const command = process.argv[2];

if (command === 'rollback') {
  rollbackMigration();
} else if (command === 'migrate' || !command) {
  runMigration();
} else {
  console.log('Usage: node run_fifo_migration.js [migrate|rollback]');
  process.exit(1);
}
