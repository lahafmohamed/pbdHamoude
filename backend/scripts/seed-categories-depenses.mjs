import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'magasin_db',
});

const categories = [
  { code: 'LOYER',     nom: 'Loyer',               description: 'Loyer et charges locatives' },
  { code: 'SALAIRE',   nom: 'Salaires',             description: 'Salaires et charges sociales' },
  { code: 'TRANSPORT', nom: 'Transport',            description: 'Frais de transport et livraison' },
  { code: 'FOURNI',    nom: 'Fournitures',          description: 'Fournitures de bureau et matériel' },
  { code: 'ELECTRI',   nom: 'Électricité / Eau',    description: 'Factures eau et électricité' },
  { code: 'TELECOM',   nom: 'Téléphone / Internet', description: 'Abonnements télécom et internet' },
  { code: 'REPAS',     nom: 'Repas / Restauration', description: 'Repas professionnels' },
  { code: 'ENTRET',    nom: 'Entretien',            description: 'Entretien et réparations' },
  { code: 'PUBLICI',   nom: 'Publicité',            description: 'Dépenses marketing et publicité' },
  { code: 'DIVERS',    nom: 'Divers',               description: 'Autres dépenses non classifiées' },
];

for (const cat of categories) {
  const { rows } = await pool.query(
    `INSERT INTO categories_depenses (code, nom, description)
     VALUES ($1, $2, $3)
     ON CONFLICT (code) DO NOTHING
     RETURNING id, code, nom`,
    [cat.code, cat.nom, cat.description]
  );
  if (rows.length > 0) {
    console.log(`✅ Créée: ${rows[0].code} — ${rows[0].nom}`);
  } else {
    console.log(`⏭️  Existe déjà: ${cat.code}`);
  }
}

const { rows: all } = await pool.query(`SELECT id, code, nom FROM categories_depenses ORDER BY nom`);
console.log(`\n📋 Total: ${all.length} catégories`);
all.forEach(r => console.log(`  [${r.id}] ${r.code} — ${r.nom}`));

await pool.end();
