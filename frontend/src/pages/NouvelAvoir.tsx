import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Check, Plus, X } from 'lucide-react';
import { creditNoteService } from '@/services/api';
import { TiersPicker } from '@/components/TiersPicker';
import { Tiers } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface AvoirLigne {
  description: string;
  quantite: number;
  prix_unitaire: number;
}

export default function NouvelAvoir() {
  const navigate = useNavigate();
  const [selectedTiers, setSelectedTiers] = useState<Tiers | null>(null);
  const [factureId, setFactureId] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lignes, setLignes] = useState<AvoirLigne[]>([
    { description: '', quantite: 1, prix_unitaire: 0 },
  ]);

  const addLine = () => {
    setLignes((prev) => [...prev, { description: '', quantite: 1, prix_unitaire: 0 }]);
  };

  const removeLine = (index: number) => {
    setLignes((prev) => prev.filter((_, i) => i !== index));
  };

  const updateLine = (index: number, field: keyof AvoirLigne, value: string | number) => {
    setLignes((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const total = lignes.reduce(
    (sum, ligne) => sum + Number(ligne.quantite || 0) * Number(ligne.prix_unitaire || 0),
    0
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const clientIdNum = selectedTiers?.id;
    const factureIdNum = Number(factureId);

    if (!clientIdNum) {
      toast.error('Le tiers (client) est obligatoire');
      return;
    }

    if (!factureIdNum || factureIdNum <= 0) {
      toast.error('La facture d origine est obligatoire');
      return;
    }

    if (lignes.length === 0) {
      toast.error('Ajoutez au moins une ligne');
      return;
    }

    for (const ligne of lignes) {
      if (!ligne.description.trim()) {
        toast.error('Chaque ligne doit contenir une description');
        return;
      }
      if (ligne.quantite <= 0 || ligne.prix_unitaire < 0) {
        toast.error('Quantité ou prix invalide');
        return;
      }
    }

    setSubmitting(true);
    try {
      await creditNoteService.createManual({
        tiers_id: clientIdNum,
        facture_origine_id: factureIdNum,
        lignes: lignes.map((ligne) => ({
          description: ligne.description,
          quantite: Number(ligne.quantite),
          prix_unitaire: Number(ligne.prix_unitaire),
        })),
        notes: notes || undefined,
        avoir_type: 'erreur',
      });
      toast.success('Avoir créé avec succès');
      navigate('/avoirs');
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Erreur lors de la création de l avoir');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-3 sm:p-6 w-full space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Nouvel Avoir</h1>
          <p className="text-muted-foreground mt-1">Créer un avoir lié à une facture validée</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Références</CardTitle>
            <CardDescription>Un avoir doit être lié à une facture d origine</CardDescription>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <TiersPicker role="client" value={selectedTiers} onChange={setSelectedTiers} />
            </div>
            <Input
              type="number"
              min={1}
              placeholder="ID Facture d origine"
              value={factureId}
              onChange={(e) => setFactureId(e.target.value)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lignes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-32">Quantité</TableHead>
                  <TableHead className="w-40">Prix unitaire</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lignes.map((ligne, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <Input
                        placeholder="Motif / produit"
                        value={ligne.description}
                        onChange={(e) => updateLine(index, 'description', e.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={1}
                        value={ligne.quantite}
                        onChange={(e) => updateLine(index, 'quantite', Number(e.target.value))}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={ligne.prix_unitaire}
                        onChange={(e) => updateLine(index, 'prix_unitaire', Number(e.target.value))}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeLine(index)}
                        disabled={lignes.length === 1}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Button type="button" variant="outline" onClick={addLine}>
              <Plus className="h-4 w-4 mr-2" />
              Ajouter une ligne
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="Commentaires optionnels"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Montant estimé HT</p>
              <p className="text-2xl font-bold">{total.toFixed(2)} XOF</p>
            </div>
            <Button type="submit" disabled={submitting}>
              <Check className="h-4 w-4 mr-2" />
              {submitting ? 'Création...' : 'Créer avoir'}
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
