import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fuzzyScore } from '@/utils/format';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { FilePlus, Search, Eye, FileCheck, Trash2 } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import { formatXOF } from '@/utils/format';
import { devisService } from '@/services/api';
import { toast } from 'sonner';

interface Devis {
  id: number;
  numero_devis: string;
  tiers_id: number;
  client_id?: number;
  client_nom: string;
  date_devis: string;
  date_validite: string | null;
  statut: 'brouillon' | 'envoye' | 'accepte' | 'annule' | 'converti' | string;
  total: number;
  notes: string | null;
}

export default function Devis() {
  const navigate = useNavigate();
  const [devis, setDevis] = useState<Devis[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadDevis();
  }, []);

  const loadDevis = async () => {
    try {
      setLoading(true);
      const data = await devisService.getAll();
      setDevis(data);
    } catch (error) {
      toast.error('Erreur lors du chargement des devis');
    } finally {
      setLoading(false);
    }
  };


  const canConfirm = (statut: string) => ['brouillon', 'envoye'].includes(statut);


  const handleConfirm = async (id: number) => {
    if (!confirm('Confirmer ce devis ? Cela générera automatiquement un bon de livraison.')) return;
    try {
      await devisService.updateStatut(id, 'accepte');
      toast.success('Devis confirmé et bon de livraison généré');
      loadDevis();
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Erreur lors de la confirmation du devis');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Supprimer ce devis ? Cette action est irreversible.')) return;
    try {
      await devisService.delete(id);
      toast.success('Devis supprimé');
      loadDevis();
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Erreur lors de la suppression');
    }
  };

  const filteredDevis = search.trim()
    ? devis
        .map((d) => ({
          d,
          score: Math.max(fuzzyScore(search, d.numero_devis), fuzzyScore(search, d.client_nom)),
        }))
        .filter((row) => row.score > 0)
        .sort((x, y) => y.score - x.score)
        .map((row) => row.d)
    : devis;

  return (
    <div className="container mx-auto py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Devis</h1>
        <Button onClick={() => navigate('/devis/nouveau')}>
          <FilePlus className="h-4 w-4 mr-2" />
          Nouveau Devis
        </Button>
      </div>

      <Card>
        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher par numéro ou client..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Numéro</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Validité</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  Chargement...
                </TableCell>
              </TableRow>
            ) : filteredDevis.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  Aucun devis trouvé
                </TableCell>
              </TableRow>
            ) : (
              filteredDevis.map((devis) => (
                <TableRow key={devis.id}>
                  <TableCell className="font-medium">{devis.numero_devis}</TableCell>
                  <TableCell>{devis.client_nom}</TableCell>
                  <TableCell>{new Date(devis.date_devis).toLocaleDateString('fr-FR')}</TableCell>
                  <TableCell>
                    {devis.date_validite
                      ? new Date(devis.date_validite).toLocaleDateString('fr-FR')
                      : '-'}
                  </TableCell>
                  <TableCell><StatusBadge type="devis" statut={devis.statut} /></TableCell>
                  <TableCell className="text-right font-medium">
                    {formatXOF(devis.total)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(`/devis/${devis.id}`)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {canConfirm(devis.statut) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleConfirm(devis.id)}
                          title="Confirmer le devis"
                        >
                          <FileCheck className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(devis.id)}
                        title="Supprimer le devis"
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
