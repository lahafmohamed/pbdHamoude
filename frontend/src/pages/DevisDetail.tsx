import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, FileCheck, Trash2, Printer, Download } from 'lucide-react';
import { devisService } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DocumentPrint } from '@/components/ui/print-layout';

export default function DevisDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [devis, setDevis] = useState<any>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const canConfirm = (statut: string) => ['brouillon', 'envoye'].includes(statut);
  const downloadPDF = () => {
    setShowPrint(true);
    setTimeout(() => window.print(), 300);
  };

  useEffect(() => {
    const load = async () => {
      if (!id) return;
      try {
        setLoading(true);
        const data = await devisService.getById(Number(id));
        setDevis(data?.data || data);
      } catch (error) {
        toast.error('Impossible de charger ce devis');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id]);

  const total = useMemo(() => {
    if (!devis?.lignes || !Array.isArray(devis.lignes)) return devis?.total || 0;
    return devis.lignes.reduce(
      (sum: number, l: any) => sum + Number(l.quantite || 0) * Number(l.prix_unitaire || 0),
      0
    );
  }, [devis]);

  const handleConfirm = async () => {
    if (!devis?.id) return;
    if (!confirm('Confirmer ce devis ? Cela générera automatiquement un bon de livraison.')) return;

    try {
      setActionLoading(true);
      await devisService.updateStatut(Number(devis.id), 'accepte');
      toast.success('Devis confirmé et bon de livraison généré');
      const refreshed = await devisService.getById(Number(devis.id));
      setDevis(refreshed?.data || refreshed);
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Erreur lors de la confirmation');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!devis?.id) return;
    if (!confirm('Supprimer ce devis ? Cette action est irreversible.')) return;

    try {
      setActionLoading(true);
      await devisService.delete(Number(devis.id));
      toast.success('Devis supprimé');
      navigate('/devis');
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Erreur lors de la suppression');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return <div className="p-6">Chargement...</div>;
  }

  if (!devis) {
    return (
      <div className="p-6 space-y-4">
        <Button variant="outline" onClick={() => navigate('/devis')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour aux devis
        </Button>
        <Card>
          <CardContent className="pt-6">Devis introuvable</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={() => navigate('/devis')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{devis.numero_devis || `Devis #${devis.id}`}</h1>
          <p className="text-muted-foreground">Client: {devis.client_nom || devis.tiers_id || '-'}</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => setShowPrint(true)}>
            <Printer className="h-4 w-4 mr-2" />
            Imprimer
          </Button>
          <Button variant="outline" onClick={downloadPDF}>
            <Download className="h-4 w-4 mr-2" />
            Télécharger PDF
          </Button>
          {canConfirm(devis.statut) && (
            <Button onClick={handleConfirm} disabled={actionLoading}>
              <FileCheck className="h-4 w-4 mr-2" />
              Confirmer
            </Button>
          )}
          <Button variant="destructive" onClick={handleDelete} disabled={actionLoading}>
            <Trash2 className="h-4 w-4 mr-2" />
            Supprimer
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Détails</CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-4 text-sm">
          <p><strong>Date:</strong> {devis.date_devis ? new Date(devis.date_devis).toLocaleDateString('fr-FR') : '-'}</p>
          <p><strong>Validité:</strong> {devis.date_validite ? new Date(devis.date_validite).toLocaleDateString('fr-FR') : '-'}</p>
          <p><strong>Statut:</strong> {devis.statut || '-'}</p>
          <p><strong>Total:</strong> {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'XOF' }).format(Number(total || 0))}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lignes du devis</CardTitle>
        </CardHeader>
        <CardContent>
          {Array.isArray(devis.lignes) && devis.lignes.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produit</TableHead>
                  <TableHead>Qté</TableHead>
                  <TableHead>Prix unitaire</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devis.lignes.map((ligne: any, idx: number) => {
                  const qte = Number(ligne.quantite || 0);
                  const pu = Number(ligne.prix_unitaire || 0);
                  return (
                    <TableRow key={idx}>
                      <TableCell>
                        {ligne.produit_nom || ligne.produit_id}
                        {(ligne as any).is_depot_only_history && (
                          <span
                            className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-200 text-gray-700"
                            title="Cet article n'a plus de stock magasin — il était disponible en dépôt au moment de la création"
                          >
                            stock dépôt (historique)
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{qte}</TableCell>
                      <TableCell>{pu.toFixed(2)} XOF</TableCell>
                      <TableCell>{(qte * pu).toFixed(2)} XOF</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">Aucune ligne à afficher</p>
          )}
        </CardContent>
      </Card>

      {showPrint && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-auto print:bg-white print:p-0 print:static print:overflow-visible">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full my-8 print:max-w-none print:w-full print:my-0 print:shadow-none print:rounded-none">
            <div className="sticky top-0 z-10 bg-white border-b p-4 flex justify-between items-center print:hidden">
              <h2 className="text-lg font-semibold">Aperçu d'impression</h2>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowPrint(false)}>Fermer</Button>
                <Button onClick={() => window.print()}>
                  <Printer className="h-4 w-4 mr-2" />
                  Imprimer
                </Button>
              </div>
            </div>
            <DocumentPrint
              docType="devis"
              numero={devis.numero_devis || `S${String(devis.id).padStart(5, '0')}`}
              dateDoc={devis.date_devis}
              dateEcheance={devis.date_validite}
              vendeur={devis.cree_par_nom || 'Administrator'}
              clientNom={devis.client_nom}
              lignes={Array.isArray(devis.lignes) ? devis.lignes : []}
            />
          </div>
        </div>
      )}
    </div>
  );
}