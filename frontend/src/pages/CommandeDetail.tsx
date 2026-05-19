import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { commandeService } from '../services/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, ShoppingCart, Truck, CheckCircle, Clock, XCircle, Package } from 'lucide-react';
import { toast } from 'sonner';

export default function CommandeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [commande, setCommande] = useState<any>(null);
  const [lignes, setLignes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCommande();
  }, [id]);

  const loadCommande = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await commandeService.getById(parseInt(id));
      setCommande(data);
      setLignes(data.lignes || []);
    } catch (error) {
      toast.error('Erreur lors du chargement de la commande');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const updateStatut = async (statut: string) => {
    if (!id) return;
    try {
      await commandeService.updateStatut(parseInt(id), statut);
      loadCommande();
      toast.success('Statut mis à jour');
    } catch (error) {
      toast.error('Erreur lors de la mise à jour');
    }
  };

  const getStatutBadge = (statut: string) => {
    switch (statut) {
      case 'en_attente':
        return <Badge variant="warning" className="gap-1 text-lg"><Clock className="h-5 w-5" /> En attente</Badge>;
      case 'validee':
        return <Badge variant="default" className="gap-1 text-lg"><CheckCircle className="h-5 w-5" /> Validée</Badge>;
      case 'expediee':
        return <Badge className="gap-1 text-lg bg-blue-500"><Truck className="h-5 w-5" /> Expédiée</Badge>;
      case 'livree':
        return <Badge variant="success" className="gap-1 text-lg"><Package className="h-5 w-5" /> Livrée</Badge>;
      case 'annulee':
        return <Badge variant="destructive" className="gap-1 text-lg"><XCircle className="h-5 w-5" /> Annulée</Badge>;
      default:
        return <Badge variant="outline">{statut}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-muted-foreground">Chargement de la commande...</p>
        </div>
      </div>
    );
  }

  if (!commande) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <ShoppingCart className="h-16 w-16 text-muted-foreground/50" />
        <h2 className="text-2xl font-bold">Commande non trouvée</h2>
        <Button onClick={() => navigate('/commandes')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour aux commandes
        </Button>
      </div>
    );
  }

  const sousTotal = parseFloat(commande.sous_total) || 0;

  return (
    <div className="p-3 sm:p-6 w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => navigate('/commandes')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <ShoppingCart className="h-8 w-8" />
              Commande {commande.numero_commande}
            </h1>
            <p className="text-muted-foreground mt-1">Détails de la commande fournisseur</p>
          </div>
        </div>
        <div className="flex gap-2">
          {getStatutBadge(commande.statut)}
        </div>
      </div>

      {/* Status Actions */}
      {commande.statut !== 'livree' && commande.statut !== 'annulee' && (
        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
            <CardDescription>Changer le statut de la commande</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              {commande.statut === 'en_attente' && (
                <Button onClick={() => updateStatut('validee')} className="gap-2">
                  <CheckCircle className="h-4 w-4" />
                  Valider la commande
                </Button>
              )}
              {commande.statut === 'validee' && (
                <Button onClick={() => updateStatut('expediee')} className="gap-2">
                  <Truck className="h-4 w-4" />
                  Marquer comme expédiée
                </Button>
              )}
              {(commande.statut === 'en_attente' || commande.statut === 'validee' || commande.statut === 'expediee') && (
                <>
                  <Button onClick={() => navigate(`/receptions?commande_id=${id}`)} className="gap-2 bg-green-600 hover:bg-green-700">
                    <Package className="h-4 w-4" />
                    Confirmer la livraison (réception)
                  </Button>
                  <Button onClick={() => updateStatut('annulee')} variant="destructive" className="gap-2">
                    <XCircle className="h-4 w-4" />
                    Annuler
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Commande Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Fournisseur</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="font-semibold text-lg">{commande.fournisseur_nom}</p>
            {commande.fournisseur_contact && <p className="text-muted-foreground">Contact: {commande.fournisseur_contact}</p>}
            {commande.fournisseur_email && <p className="text-muted-foreground">Email: {commande.fournisseur_email}</p>}
            {commande.fournisseur_telephone && <p className="text-muted-foreground">Tél: {commande.fournisseur_telephone}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Informations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Date de commande:</span>
              <span className="font-semibold">
                {new Date(commande.date_commande).toLocaleDateString('fr-FR', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </span>
            </div>
            {commande.date_livraison_prevue && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Livraison prévue:</span>
                <span className="font-semibold">{new Date(commande.date_livraison_prevue).toLocaleDateString('fr-FR')}</span>
              </div>
            )}
            {commande.date_livraison_reelle && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Livraison réelle:</span>
                <span className="font-semibold text-green-600">{new Date(commande.date_livraison_reelle).toLocaleDateString('fr-FR')}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">N° Commande:</span>
              <span className="font-mono font-semibold">{commande.numero_commande}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Line Items */}
      <Card>
        <CardHeader>
          <CardTitle>Articles commandés</CardTitle>
          <CardDescription>{lignes.length} article(s)</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Référence</TableHead>
                <TableHead>Produit</TableHead>
                <TableHead className="text-right">Quantité</TableHead>
                <TableHead className="text-right">Prix unitaire</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lignes.map((ligne) => (
                <TableRow key={ligne.id}>
                  <TableCell className="font-mono">{ligne.produit_reference}</TableCell>
                  <TableCell className="font-semibold">{ligne.produit_nom}</TableCell>
                  <TableCell className="text-right">{ligne.quantite}</TableCell>
                  <TableCell className="text-right">{parseFloat(ligne.prix_unitaire).toFixed(2)} XOF</TableCell>
                  <TableCell className="text-right font-bold">{parseFloat(ligne.total_ligne).toFixed(2)} XOF</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Summary */}
      <Card className="bg-primary text-primary-foreground">
        <CardContent className="pt-6">
          <div className="space-y-3">
            <div className="flex justify-between text-lg">
              <span className="text-primary-foreground/80">Sous-total</span>
              <span className="font-semibold">{sousTotal.toFixed(2)} XOF</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notes */}
      {commande.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground whitespace-pre-wrap">{commande.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
