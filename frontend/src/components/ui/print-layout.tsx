import { Button } from './button';
import { Printer } from 'lucide-react';

interface PrintLayoutProps {
  title: string;
  children: React.ReactNode;
  onPrint?: () => void;
}

export function PrintLayout({ title: _title, children, onPrint }: PrintLayoutProps) {
  const handlePrint = () => {
    if (onPrint) onPrint();
    else window.print();
  };

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <Button onClick={handlePrint} className="gap-2">
          <Printer className="h-4 w-4" />
          Imprimer
        </Button>
      </div>
      <div className="print:shadow-none print:border-none">{children}</div>
    </div>
  );
}

// ============================================================
// Generic PBD document print template
// Matches "Devis - S00002.pdf" model — works for Devis / Facture / BL
// ============================================================

export type DocType = 'devis' | 'facture' | 'bl';

interface PrintLigne {
  produit_nom?: string;
  produit_reference?: string;
  description?: string;
  quantite: number | string;
  quantite_livree?: number | string;
  prix_unitaire: number | string;
  tva_taux?: number | string;
}

interface DocumentPrintProps {
  docType: DocType;
  numero: string;
  dateDoc?: string | Date | null;
  dateEcheance?: string | Date | null;
  vendeur?: string;
  clientNom?: string;
  clientPrenom?: string;
  lignes: PrintLigne[];
  tvaIncluded?: boolean;
  hideTotals?: boolean;
}

const titleLabel: Record<DocType, string> = {
  devis: 'Devis',
  facture: 'Facture',
  bl: 'Bon de Livraison',
};

const dateLabels: Record<DocType, { date: string; echeance: string }> = {
  devis: { date: 'Date du devis', echeance: 'Échéance' },
  facture: { date: 'Date de la facture', echeance: 'Échéance' },
  bl: { date: 'Date du bon', echeance: 'Date de livraison' },
};

const fmtDate = (d?: string | Date | null) => {
  if (!d) return '-';
  try {
    return new Date(d).toLocaleDateString('fr-FR');
  } catch {
    return '-';
  }
};

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' CFA';

const fmtQty = (n: number) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export function DocumentPrint({
  docType,
  numero,
  dateDoc,
  dateEcheance,
  vendeur,
  clientNom,
  clientPrenom,
  lignes,
  tvaIncluded = true,
  hideTotals = false,
}: DocumentPrintProps) {
  const rows = lignes.map((l) => {
    const qte = Number(docType === 'bl' ? (l.quantite_livree ?? l.quantite) : l.quantite) || 0;
    const pu = Number(l.prix_unitaire) || 0;
    const tva = l.tva_taux !== undefined ? Number(l.tva_taux) : (tvaIncluded ? 18 : 0);
    const montant = qte * pu;
    return { ...l, qte, pu, tva, montant };
  });

  const sousTotal = rows.reduce((s, r) => s + r.montant, 0);
  const totalTva = rows.reduce((s, r) => s + r.montant * (r.tva / 100), 0);
  const total = sousTotal + totalTva;
  const hasTva = totalTva > 0;
  const tvaPctDisplay = rows.find((r) => r.tva > 0)?.tva ?? 18;

  const labels = dateLabels[docType];
  const clientFull = [clientNom, clientPrenom].filter(Boolean).join(' ').trim();

  return (
    <div className="pbd-print-doc">
      <div className="pbd-print-page">
        {/* Header: logo + company addr */}
        <div className="pbd-header">
          <img src="/logo.png" alt="PBD SARL" className="pbd-logo" />
          <div className="pbd-company">
            <div>Pneu Batteries Divers (PBD)</div>
            <div>TREICHVILLE AVENUE 8 RUE 17 PRES DE LA BANQUE SIB</div>
            <div>abidjan Côte d'Ivoire</div>
          </div>
        </div>

        {/* Client name centered */}
        <div className="pbd-client">{clientFull || '-'}</div>

        {/* Title */}
        <h1 className="pbd-title">
          {titleLabel[docType]} # {numero}
        </h1>

        {/* Meta cols */}
        <div className="pbd-meta">
          <div>
            <div className="pbd-meta-label">{labels.date}</div>
            <div>{fmtDate(dateDoc)}</div>
          </div>
          <div>
            <div className="pbd-meta-label">{labels.echeance}</div>
            <div>{fmtDate(dateEcheance)}</div>
          </div>
          <div>
            <div className="pbd-meta-label">Vendeur</div>
            <div>{vendeur || 'Administrator'}</div>
          </div>
        </div>

        {/* Items table */}
        <table className="pbd-table">
          <thead>
            <tr>
              <th className="pbd-col-desc">Description</th>
              <th className="pbd-col-qte">Quantité</th>
              <th className="pbd-col-pu">Prix unitaire</th>
              {docType !== 'bl' && <th className="pbd-col-tva">TVA</th>}
              <th className="pbd-col-mt">Montant</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const refTag = r.produit_reference ? `[${r.produit_reference}] ` : '';
              const mainName = r.produit_nom || r.description || '';
              const subDesc = r.produit_reference && r.description && r.description !== r.produit_nom
                ? r.description
                : '';
              return (
                <tr key={i}>
                  <td className="pbd-col-desc">
                    <div>{refTag}{mainName}</div>
                    {subDesc && <div className="pbd-subdesc">{subDesc}</div>}
                  </td>
                  <td className="pbd-col-qte">
                    {fmtQty(r.qte)}<br />
                    <span className="pbd-unite">Unité(s)</span>
                  </td>
                  <td className="pbd-col-pu">{fmtQty(r.pu)}</td>
                  {docType !== 'bl' && (
                    <td className="pbd-col-tva">{r.tva > 0 ? `${r.tva}%` : '-'}</td>
                  )}
                  <td className="pbd-col-mt">{fmtMoney(r.montant)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Totals */}
        {!hideTotals && (
          <div className="pbd-totals">
            <div className="pbd-totals-box">
              <div className="pbd-total-row">
                <span>Montant hors taxes</span>
                <span>{fmtMoney(sousTotal)}</span>
              </div>
              {hasTva && (
                <div className="pbd-total-row">
                  <span>T.V.A. {tvaPctDisplay}%</span>
                  <span>{fmtMoney(totalTva)}</span>
                </div>
              )}
              <div className="pbd-total-row pbd-total-grand">
                <span>Total</span>
                <span>{fmtMoney(total)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="pbd-footer">
          <span>
            26 BP 195 ABIDJAN 26 | +225 0707402033 / +225 0779037116 | pbdautoplus@gmail.com SIB : 007 0196
            9000104 | ABIDJAN - TREICHVILLE AVENUE 8 RUE 17 PRÈS DE LA BANQUE SIB
          </span>
          <span className="pbd-page">Page 1 / 1</span>
        </div>
      </div>

      <style>{`
        .pbd-print-doc {
          background: #fff;
          color: #111;
          font-family: 'Helvetica Neue', Arial, sans-serif;
        }
        .pbd-print-page {
          max-width: 800px;
          margin: 0 auto;
          padding: 32px 40px 80px;
          position: relative;
          min-height: 1050px;
        }
        .pbd-header {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-bottom: 60px;
        }
        .pbd-logo {
          width: 130px;
          height: auto;
          object-fit: contain;
        }
        .pbd-company {
          font-size: 12px;
          line-height: 1.5;
          color: #222;
        }
        .pbd-client {
          text-align: center;
          font-size: 13px;
          margin-bottom: 20px;
          min-height: 18px;
        }
        .pbd-title {
          font-size: 32px;
          font-weight: 300;
          color: #9a9a9a;
          margin: 0 0 28px;
        }
        .pbd-meta {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 12px;
          margin-bottom: 32px;
          font-size: 12px;
        }
        .pbd-meta-label {
          font-weight: 700;
          color: #111;
          margin-bottom: 2px;
        }
        .pbd-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
          margin-bottom: 24px;
        }
        .pbd-table thead th {
          text-align: left;
          font-weight: 400;
          color: #444;
          border-bottom: 1px solid #ddd;
          padding: 8px 6px;
        }
        .pbd-table .pbd-col-qte,
        .pbd-table .pbd-col-pu,
        .pbd-table .pbd-col-tva,
        .pbd-table .pbd-col-mt {
          text-align: right;
        }
        .pbd-table tbody td {
          padding: 10px 6px;
          vertical-align: top;
          border-bottom: 1px solid #f2f2f2;
        }
        .pbd-subdesc {
          color: #666;
          font-size: 11px;
          margin-top: 2px;
        }
        .pbd-unite {
          color: #888;
          font-size: 11px;
        }
        .pbd-totals {
          display: flex;
          justify-content: flex-end;
          margin-top: 12px;
        }
        .pbd-totals-box {
          width: 55%;
          font-size: 12px;
        }
        .pbd-total-row {
          display: flex;
          justify-content: space-between;
          padding: 6px 6px;
          border-bottom: 1px solid #f0f0f0;
        }
        .pbd-total-grand {
          color: #9a9a9a;
          font-weight: 500;
          border-bottom: none;
          padding-top: 10px;
        }
        .pbd-total-grand span:last-child {
          color: #9a9a9a;
        }
        .pbd-footer {
          position: absolute;
          bottom: 24px;
          left: 40px;
          right: 40px;
          display: flex;
          justify-content: space-between;
          gap: 16px;
          font-size: 10px;
          color: #555;
          border-top: 1px solid #eee;
          padding-top: 10px;
        }
        .pbd-page {
          white-space: nowrap;
        }
        @media print {
          @page { size: A4; margin: 0; }
          html, body { background: #fff !important; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          body * { visibility: hidden !important; }
          .pbd-print-doc, .pbd-print-doc * { visibility: visible !important; }
          .pbd-print-doc {
            position: absolute !important;
            left: 0; top: 0; right: 0;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .print\\:hidden { display: none !important; }
          .pbd-print-page { box-shadow: none !important; min-height: 100vh; }
        }
      `}</style>
    </div>
  );
}

// ============================================================
// Backwards-compat shim — older FactureDetail still imports InvoicePrint
// ============================================================
interface InvoicePrintProps {
  invoice: any;
  client: any;
  lignes: any[];
  company?: any;
}

export function InvoicePrint({ invoice, client, lignes }: InvoicePrintProps) {
  return (
    <DocumentPrint
      docType="facture"
      numero={invoice?.numero_facture || invoice?.numero || String(invoice?.id ?? '')}
      dateDoc={invoice?.date_facture}
      dateEcheance={invoice?.date_echeance}
      vendeur={invoice?.cree_par_nom || invoice?.vendeur_nom}
      clientNom={client?.nom || client?.raison_sociale}
      clientPrenom={client?.prenom}
      lignes={lignes || []}
    />
  );
}
