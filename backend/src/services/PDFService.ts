import PDFDocument from 'pdfkit';
import pool from '../db/connection';

export type DocumentType = 'facture' | 'devis' | 'bl' | 'avoir';

interface DocumentConfig {
  title: string;
  numeroField: string;
  dateField: string;
  recipientLabel: string;
  statusLabels: Record<string, string>;
  statusColors: Record<string, string>;
  showPayments: boolean;
  showTVA: boolean;
}

const DOCUMENT_CONFIGS: Record<DocumentType, DocumentConfig> = {
  facture: {
    title: 'FACTURE',
    numeroField: 'numero_facture',
    dateField: 'date_facture',
    recipientLabel: 'Facturé à:',
    statusLabels: { payee: 'PAYÉE', partielle: 'PARTIELLEMENT PAYÉE', en_attente: 'EN ATTENTE', annulee: 'ANNULÉE' },
    statusColors: { payee: '#22c55e', partielle: '#f59e0b', en_attente: '#6b7280', annulee: '#ef4444' },
    showPayments: true,
    showTVA: true,
  },
  devis: {
    title: 'DEVIS',
    numeroField: 'numero_devis',
    dateField: 'date_devis',
    recipientLabel: 'Devis pour:',
    statusLabels: { brouillon: 'BROUILLON', envoye: 'ENVOYÉ', accepte: 'ACCEPTÉ', refuse: 'REFUSÉ', converti: 'CONVERTI', annule: 'ANNULÉ' },
    statusColors: { brouillon: '#6b7280', envoye: '#3b82f6', accepte: '#22c55e', refuse: '#ef4444', converti: '#8b5cf6', annule: '#9ca3af' },
    showPayments: false,
    showTVA: true,
  },
  bl: {
    title: 'BON DE LIVRAISON',
    numeroField: 'numero_bl',
    dateField: 'date_bl',
    recipientLabel: 'Livré à:',
    statusLabels: { brouillon: 'BROUILLON', valide: 'VALIDÉ', livre: 'LIVRÉ', facture: 'FACTURÉ', annule: 'ANNULÉ' },
    statusColors: { brouillon: '#6b7280', valide: '#3b82f6', livre: '#22c55e', facture: '#8b5cf6', annule: '#9ca3af' },
    showPayments: false,
    showTVA: false,
  },
  avoir: {
    title: 'AVOIR',
    numeroField: 'numero_avoir',
    dateField: 'date_avoir',
    recipientLabel: 'Client:',
    statusLabels: { brouillon: 'BROUILLON', en_attente: 'EN ATTENTE', valide: 'VALIDÉ', utilise: 'UTILISÉ', annule: 'ANNULÉ' },
    statusColors: { brouillon: '#6b7280', en_attente: '#f59e0b', valide: '#22c55e', utilise: '#8b5cf6', annule: '#ef4444' },
    showPayments: false,
    showTVA: true,
  },
};

const METHODE_LABELS: Record<string, string> = {
  espece: 'Espèces',
  carte: 'Carte bancaire',
  cheque: 'Chèque',
  virement: 'Virement',
};

export class PDFService {
  /**
   * Generate PDF for any document type
   */
  async generateDocumentPDF(type: DocumentType, id: number): Promise<Buffer> {
    const config = DOCUMENT_CONFIGS[type];

    // Fetch document data
    const tableMap: Record<DocumentType, string> = {
      facture: 'factures',
      devis: 'devis',
      bl: 'bons_livraison',
      avoir: 'factures_avoir',
    };
    const table = tableMap[type];

    const { rows: docRows } = await pool.query(
      `SELECT t.*, c.raison_sociale as client_nom, c.prenom as client_prenom, c.adresse as client_adresse,
              c.telephone as client_telephone, c.email as client_email, c.nif as client_nif
       FROM ${table} t
       LEFT JOIN tiers c ON t.tiers_id = c.id
       WHERE t.id = $1`,
      [id]
    );

    if (docRows.length === 0) {
      throw new Error(`${config.title} non trouvé(e)`);
    }

    const document = docRows[0];

    // Fetch lines from unified table
    const { rows: lignesRows } = await pool.query(
      `SELECT dl.*, p.nom as produit_nom, p.reference as produit_reference
       FROM document_lignes dl
       LEFT JOIN produits p ON dl.produit_id = p.id
       WHERE dl.document_type = $1 AND dl.document_id = $2`,
      [type, id]
    );

    // Fetch payments (only for invoices)
    let paiementsRows: any[] = [];
    if (type === 'facture') {
      const { rows } = await pool.query(
        `SELECT montant, methode_paiement, date_paiement, reference
         FROM paiements
         WHERE facture_id = $1
         ORDER BY date_paiement ASC`,
        [id]
      );
      paiementsRows = rows;
    }

    return this.createPDFBuffer(document, lignesRows, paiementsRows, config);
  }

  // Convenience wrappers
  generateInvoicePDF(factureId: number) { return this.generateDocumentPDF('facture', factureId); }
  generateDevisPDF(devisId: number) { return this.generateDocumentPDF('devis', devisId); }
  generateBLPDF(blId: number) { return this.generateDocumentPDF('bl', blId); }
  generateAvoirPDF(avoirId: number) { return this.generateDocumentPDF('avoir', avoirId); }

  private createPDFBuffer(
    document: any,
    lignes: any[],
    paiements: any[],
    config: DocumentConfig
  ): Promise<Buffer> {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: `${config.title} ${document[config.numeroField]}`,
        Author: 'Magasin Info',
        Creator: 'Magasin ERP System',
      },
    });

    const buffers: Buffer[] = [];
    doc.on('data', (chunk) => buffers.push(chunk));

    return new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      this.buildDocumentPDF(doc, document, lignes, paiements, config);
      doc.end();
    });
  }

  private buildDocumentPDF(
    doc: PDFKit.PDFDocument,
    document: any,
    lignes: any[],
    paiements: any[],
    config: DocumentConfig
  ): void {
    const pageWidth = doc.page.width;
    const margin = 50;
    const contentWidth = pageWidth - 2 * margin;

    // Header
    doc.fontSize(24).font('Helvetica-Bold').fillColor('#1a1a1a')
      .text(config.title, { align: 'right' });

    doc.fontSize(12).font('Helvetica').fillColor('#666666')
      .text(document[config.numeroField], { align: 'right' });

    doc.fontSize(10).fillColor('#999999')
      .text(`Date: ${new Date(document[config.dateField]).toLocaleDateString('fr-FR')}`, { align: 'right' });

    doc.moveDown(1);

    // Company info
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a1a1a')
      .text('Magasin Info', margin, doc.y);

    doc.fontSize(10).font('Helvetica').fillColor('#666666')
      .text('Adresse du magasin')
      .text('Téléphone: XX XX XX XX')
      .text('Email: contact@magasin.dz');

    // Client info
    const clientX = pageWidth / 2;
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#1a1a1a')
      .text(config.recipientLabel, clientX, doc.y - 60);

    doc.fontSize(10).font('Helvetica').fillColor('#333333')
      .text(`${document.client_nom} ${document.client_prenom || ''}`, clientX)
      .text(document.client_adresse || '', clientX)
      .text(document.client_telephone ? `Tél: ${document.client_telephone}` : '', clientX)
      .text(document.client_email || '', clientX);

    if (document.client_nif) {
      doc.text(`NIF: ${document.client_nif}`, clientX);
    }

    doc.moveDown(2);

    // Items table
    const tableTop = doc.y + 10;
    const tableColumns = [
      { key: 'produit', x: margin, width: contentWidth * 0.4 },
      { key: 'quantite', x: margin + contentWidth * 0.4, width: contentWidth * 0.15 },
      { key: 'prix', x: margin + contentWidth * 0.55, width: contentWidth * 0.2 },
      { key: 'total', x: margin + contentWidth * 0.75, width: contentWidth * 0.25 },
    ];

    doc.rect(margin, tableTop, contentWidth, 25).fill('#f5f5f5');

    doc.fontSize(10).font('Helvetica-Bold').fillColor('#333333');
    const colLabels: Record<string, string> = { produit: 'Produit', quantite: 'Qté', prix: 'Prix Unitaire', total: 'Total' };
    tableColumns.forEach(col => {
      doc.text(colLabels[col.key] || col.key, col.x + 5, tableTop + 7, { width: col.width - 10 });
    });

    let currentY = tableTop + 30;
    doc.fontSize(10).font('Helvetica').fillColor('#333333');

    lignes.forEach((ligne, index) => {
      if (index % 2 === 1) {
        doc.rect(margin, currentY - 5, contentWidth, 20).fill('#fafafa');
      }

      const produitNom = ligne.produit_nom || ligne.description || 'N/A';
      const quantite = parseInt(ligne.quantite);
      const prixUnitaire = parseFloat(ligne.prix_unitaire);
      const totalLigne = parseFloat(ligne.total_ligne);

      doc.text(produitNom, tableColumns[0].x + 5, currentY, { width: tableColumns[0].width - 10 });
      doc.text(String(quantite), tableColumns[1].x + 5, currentY, { width: tableColumns[1].width - 10, align: 'center' });
      doc.text(`${prixUnitaire.toFixed(2)} XOF`, tableColumns[2].x + 5, currentY, { width: tableColumns[2].width - 10 });
      doc.text(`${totalLigne.toFixed(2)} XOF`, tableColumns[3].x + 5, currentY, { width: tableColumns[3].width - 10 });

      currentY += 20;
    });

    doc.rect(margin, currentY, contentWidth, 1).fill('#cccccc');
    currentY += 10;

    // Totals
    const sousTotal = parseFloat(document.sous_total || 0);
    const total = parseFloat(document.total || 0);
    const remise = parseFloat(document.remise_globale || 0);
    const tva = parseFloat(document.tva || 0);

    doc.fontSize(10).font('Helvetica').fillColor('#333333');

    if (remise > 0) {
      doc.text('Sous-total:', pageWidth - margin - 150, currentY, { width: 100, align: 'right' });
      doc.text(`${sousTotal.toFixed(2)} XOF`, pageWidth - margin, currentY, { width: 50, align: 'right' });
      currentY += 15;

      doc.text('Remise:', pageWidth - margin - 150, currentY, { width: 100, align: 'right' });
      doc.text(`-${remise.toFixed(2)} XOF`, pageWidth - margin, currentY, { width: 50, align: 'right' });
      currentY += 15;
    }

    if (config.showTVA && tva > 0) {
      doc.text('Sous-total:', pageWidth - margin - 150, currentY, { width: 100, align: 'right' });
      doc.text(`${sousTotal.toFixed(2)} XOF`, pageWidth - margin, currentY, { width: 50, align: 'right' });
      currentY += 15;

      const tvaRate = document.tva_rate || 19;
      doc.text(`TVA (${tvaRate}%):`, pageWidth - margin - 150, currentY, { width: 100, align: 'right' });
      doc.text(`${tva.toFixed(2)} XOF`, pageWidth - margin, currentY, { width: 50, align: 'right' });
      currentY += 15;
    }

    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a1a1a');
    doc.text('TOTAL:', pageWidth - margin - 150, currentY, { width: 100, align: 'right' });
    doc.text(`${total.toFixed(2)} XOF`, pageWidth - margin, currentY, { width: 50, align: 'right' });
    currentY += 30;

    // Payments
    if (config.showPayments && paiements.length > 0) {
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#1a1a1a')
        .text('Paiements effectués:', margin, currentY);
      currentY += 20;

      doc.fontSize(10).font('Helvetica').fillColor('#333333');
      paiements.forEach(paiement => {
        const montant = parseFloat(paiement.montant);
        const date = new Date(paiement.date_paiement).toLocaleDateString('fr-FR');
        doc.text(
          `- ${date}: ${montant.toFixed(2)} XOF (${METHODE_LABELS[paiement.methode_paiement] || paiement.methode_paiement})`,
          margin + 10, currentY
        );
        currentY += 15;
      });
    }

    // Status
    currentY += 10;
    const statut = document.statut;
    doc.fontSize(12).font('Helvetica-Bold')
      .fillColor(config.statusColors[statut] || '#666666')
      .text(`Statut: ${config.statusLabels[statut] || statut}`, margin, currentY);

    // Notes
    if (document.notes) {
      currentY += 30;
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#333333')
        .text('Notes:', margin, currentY);
      doc.fontSize(9).font('Helvetica').fillColor('#666666')
        .text(document.notes, margin, currentY + 15);
    }

    // Footer
    doc.fontSize(8).fillColor('#999999')
      .text('Magasin Info - Document généré automatiquement', margin, pageWidth - 100, { align: 'center' });
  }
}

export const pdfService = new PDFService();
