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
import { FilePlus, Search, Eye, FileCheck } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import { formatXOF } from '@/utils/format';
import { bonLivraisonService } from '@/services/api';
import { toast } from 'sonner';

interface BonLivraison {
  id: number;
  numero_bl: string;
  tiers_id: number;
  client_id?: number;
  client_nom: string;
  date_bl: string;
  statut: 'valide' | 'livre' | 'facture' | 'annule' | string;
  total: number;
  notes: string | null;
}

export default function BonsLivraison() {
  const navigate = useNavigate();
  const [bons, setBons] = useState<BonLivraison[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadBons();
  }, []);

  const loadBons = async () => {
    try {
      setLoading(true);
      const data = await bonLivraisonService.getAll();
      setBons(data);
    } catch (error) {
      toast.error('Erreur lors du chargement des bons de livraison');
    } finally {
      setLoading(false);
    }
  };



  const handleConvert = async (id: number) => {
    if (!confirm('Convertir ce bon de livraison en facture ?')) return;
    try {
      await bonLivraisonService.convertToFacture(id);
      toast.success('Bon de livraison converti en facture');
      loadBons();
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Erreur lors de la conversion');
    }
  };

  const filteredBons = search.trim()
    ? bons
        .map((b) => ({
          b,
          score: Math.max(fuzzyScore(search, b.numero_bl || ''), fuzzyScore(search, b.client_nom || '')),
        }))
        .filter((row) => row.score > 0)
        .sort((x, y) => y.score - x.score)
        .map((row) => row.b)
    : bons;

  return (
    <div className="container mx-auto py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Bons de Livraison</h1>
        <Button onClick={() => navigate('/bons-livraison/nouveau')}>
          <FilePlus className="h-4 w-4 mr-2" />
          Nouveau Bon (depuis devis)
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
              <TableHead>Statut</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">
                  Chargement...
                </TableCell>
              </TableRow>
            ) : filteredBons.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">
                  Aucun bon de livraison trouvé
                </TableCell>
              </TableRow>
            ) : (
              filteredBons.map((bon) => (
                <TableRow key={bon.id}>
                  <TableCell className="font-medium">{bon.numero_bl}</TableCell>
                  <TableCell>{bon.client_nom}</TableCell>
                  <TableCell>{new Date(bon.date_bl).toLocaleDateString('fr-FR')}</TableCell>
                  <TableCell><StatusBadge type="bl" statut={bon.statut} /></TableCell>
                  <TableCell className="text-right font-medium">
                    {formatXOF(bon.total)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(`/bons-livraison/${bon.id}`)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {bon.statut === 'livre' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleConvert(bon.id)}
                        >
                          <FileCheck className="h-4 w-4" />
                        </Button>
                      )}
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
