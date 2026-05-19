import pandas as pd
import psycopg2
import sys

XLSX = r'C:/Users/Mohamed/Downloads/STOCK PBD A JOUR.xlsx'
LOCATION_ID = 1  # DEPOT01 Principal

df = pd.read_excel(XLSX, sheet_name=0, header=0)
df.columns = [str(c).strip() for c in df.columns]
df = df.rename(columns={
    'ARTICLES': 'nom',
    'PRIX DE REVIENS TTC': 'prix_achat',
    'QUANTITES': 'stock',
})
df = df[['nom', 'prix_achat', 'stock']]
df = df.dropna(subset=['nom'])
df['nom'] = df['nom'].astype(str).str.strip()
df = df[df['nom'] != '']
df = df[~df['nom'].str.lower().isin(['total', 'totaux', 'nan'])]
df['prix_achat'] = pd.to_numeric(df['prix_achat'], errors='coerce').fillna(0)
df['stock'] = pd.to_numeric(df['stock'], errors='coerce').fillna(0).astype(int)
df = df[df['prix_achat'] > 0]
df = df.reset_index(drop=True)
print(f'Rows to import: {len(df)}')

conn = psycopg2.connect(host='localhost', port=5432, user='postgres', password='', dbname='pbdsarl')
cur = conn.cursor()

cur.execute("SELECT COALESCE(MAX(CAST(SUBSTRING(reference FROM 2) AS INT)), 0) FROM produits WHERE reference ~ '^P[0-9]+$'")
start = cur.fetchone()[0] + 1

created = 0
errors = []
for i, row in df.iterrows():
    ref = f'P{start + i:05d}'
    nom = row['nom'][:255]
    pa = float(row['prix_achat'])
    qt = int(row['stock'])
    try:
        cur.execute(
            "INSERT INTO produits (reference, nom, prix_achat, prix_vente, stock, stock_min) "
            "VALUES (%s, %s, %s, 0, %s, 5) RETURNING id",
            (ref, nom, pa, qt),
        )
        pid = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO stock_par_location (produit_id, location_id, quantite) VALUES (%s, %s, %s)",
            (pid, LOCATION_ID, qt),
        )
        created += 1
    except Exception as e:
        conn.rollback()
        errors.append((i, nom, str(e)))
        continue

conn.commit()
cur.close()
conn.close()
print(f'Created: {created}')
print(f'Errors: {len(errors)}')
for e in errors[:10]:
    print(e)
