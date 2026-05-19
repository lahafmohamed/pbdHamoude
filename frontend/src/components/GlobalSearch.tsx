import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { produitService, tiersService, factureService } from '../services/api';
import { Command, Package, Users, FileText, Search } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface SearchResult {
  type: 'produit' | 'tiers' | 'facture';
  id: number;
  title: string;
  subtitle: string;
  url: string;
}

export function GlobalSearch() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Toggle with Ctrl+K / Cmd+K
  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setOpen((prev) => !prev);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  // Search on input change
  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    
    if (!search) {
      setResults([]);
      return;
    }

    setLoading(true);
    timeoutRef.current = setTimeout(async () => {
      try {
        const [produits, tiersResults, factures] = await Promise.all([
          produitService.searchFuzzy(search, 5, 0.1).catch(() => []),
          tiersService.search(search).catch(() => []),
          factureService.getAll(search, undefined, 1, 5).catch(() => ({ data: [] })),
        ]);

        const searchResults: SearchResult[] = [
          ...(produits || []).map((p: any) => ({
            type: 'produit' as const,
            id: p.id,
            title: p.nom,
            subtitle: `${p.reference} - ${p.categorie || 'Sans catégorie'}`,
            url: `/inventaire`,
          })),
          ...(Array.isArray(tiersResults) ? tiersResults : []).slice(0, 5).map((t: any) => ({
            type: 'tiers' as const,
            id: t.id,
            title: t.raison_sociale,
            subtitle: t.email || t.telephone || (t.est_client && t.est_fournisseur ? 'Client & Fournisseur' : t.est_client ? 'Client' : 'Fournisseur'),
            url: `/tiers/${t.id}`,
          })),
          ...(factures.data || []).map((f: any) => ({
            type: 'facture' as const,
            id: f.id,
            title: f.numero_facture,
            subtitle: `${f.client_nom || '-'} - ${parseFloat(f.total).toFixed(0)} XOF`,
            url: `/factures/${f.id}`,
          })),
        ];

        setResults(searchResults);
        setSelectedIndex(0);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [search]);

  const handleSelect = (result: SearchResult) => {
    setOpen(false);
    setSearch('');
    navigate(result.url);
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'produit': return <Package className="h-4 w-4 text-blue-500" />;
      case 'facture': return <FileText className="h-4 w-4 text-purple-500" />;
      case 'tiers': return <Users className="h-4 w-4 text-orange-500" />;
      default: return <Search className="h-4 w-4" />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0 max-w-2xl">
        <div className="p-4 border-b">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher produits, clients, factures, fournisseurs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-none focus-visible:ring-0 shadow-none"
              autoFocus
            />
            <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
              <Command className="h-3 w-3" /> K
            </kbd>
          </div>
        </div>
        
        <div className="max-h-[60vh] overflow-y-auto">
          {loading && (
            <div className="flex justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}
          
          {!loading && results.length === 0 && search && (
            <div className="text-center py-8 text-muted-foreground">
              <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Aucun résultat pour "{search}"</p>
            </div>
          )}
          
          {!loading && results.map((result, index) => (
            <button
              key={`${result.type}-${result.id}`}
              className={`w-full px-4 py-3 flex items-center gap-3 hover:bg-muted transition-colors ${
                index === selectedIndex ? 'bg-muted' : ''
              }`}
              onClick={() => handleSelect(result)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              {getTypeIcon(result.type)}
              <div className="flex-1 text-left">
                <p className="font-medium text-sm">{result.title}</p>
                <p className="text-xs text-muted-foreground">{result.subtitle}</p>
              </div>
              <span className="text-xs text-muted-foreground capitalize">{result.type}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
