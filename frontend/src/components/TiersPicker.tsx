import { useState, useEffect, useRef } from 'react';
import { Search, X, Users, Truck, UserCheck } from 'lucide-react';
import { tiersService } from '../services/api';
import { Tiers } from '../types';

interface TiersPickerProps {
  role?: 'client' | 'fournisseur';
  value: Tiers | null;
  onChange: (tiers: Tiers | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function TiersPicker({ role, value, onChange, placeholder, disabled = false }: TiersPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Tiers[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (query.length < 1) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await tiersService.search(query, role);
        setResults(data);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query, role]);

  const RoleIcon = role === 'client' ? Users : role === 'fournisseur' ? Truck : UserCheck;

  if (value) {
    return (
      <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
        <div className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-sm">
          {value.raison_sociale.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">
            {value.raison_sociale}{value.prenom ? ` ${value.prenom}` : ''}
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <span className="font-mono">{value.code}</span>
            {value.telephone && <span>· {value.telephone}</span>}
            {value.est_client && value.est_fournisseur && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-medium">
                <UserCheck className="h-2.5 w-2.5" /> Mixte
              </span>
            )}
          </div>
        </div>
        {!disabled && (
          <button type="button" onClick={() => onChange(null)} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <RoleIcon className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder || (role === 'client' ? 'Rechercher un client...' : role === 'fournisseur' ? 'Rechercher un fournisseur...' : 'Rechercher un tiers...')}
          disabled={disabled}
          className="w-full pl-9 pr-9 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
        />
      </div>

      {open && query.length >= 1 && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-popover border rounded-md shadow-lg max-h-64 overflow-y-auto">
          {loading && (
            <div className="px-3 py-2 text-sm text-muted-foreground">Recherche...</div>
          )}
          {!loading && results.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">Aucun résultat pour « {query} »</div>
          )}
          {results.map(t => (
            <button
              key={t.id}
              type="button"
              onMouseDown={() => { onChange(t); setQuery(''); setOpen(false); }}
              className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-accent transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-semibold shrink-0">
                {t.raison_sociale.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {t.raison_sociale}{t.prenom ? ` ${t.prenom}` : ''}
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <span className="font-mono">{t.code}</span>
                  {t.telephone && <span>{t.telephone}</span>}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                {t.est_client && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-100 text-blue-700">Client</span>
                )}
                {t.est_fournisseur && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-orange-100 text-orange-700">Fourn.</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
