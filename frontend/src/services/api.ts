import axios from 'axios';
import { Produit, Client, FactureComplete, Paiement, StatsDashboard } from '../types';

type CreateProduitPayload = Omit<Produit, 'id' | 'stock'> & {
  stock?: number;
  location_id?: number;
  initial_stock?: number;
  fournisseur_id?: number | null;
};

type UpdateProduitPayload = Partial<Omit<Produit, 'id'>> & {
  fournisseur_id?: number | null;
};

const api = axios.create({
  baseURL: '/api',
});

// Request interceptor: attach auth token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: unwrap { success, data, pagination } envelope
api.interceptors.response.use(
  (response) => {
    const body = response.data;
    // If the response has the new envelope format, unwrap data
    if (body && typeof body === 'object' && 'success' in body) {
      if (body.data !== undefined) {
        // If there's pagination, attach it to the unwrapped data
        const result = body.data;
        if (body.pagination && typeof result === 'object') {
          (result as any).pagination = body.pagination;
        }
        return { ...response, data: result };
      }
      // No data field (e.g., message-only responses)
      return { ...response, data: body };
    }
    return response;
  },
  (error) => {
    // Unwrap error response too
    if (error.response?.data && 'success' in error.response.data) {
      error.response.data = error.response.data;
    }
    return Promise.reject(error);
  }
);

// ========== PRODUITS ==========
export const produitService = {
  getAll: async (
    search?: string,
    categorie?: string,
    lowStock?: boolean,
    page = 1,
    limit = 20,
    sort = 'nom',
    order = 'asc',
    locationId?: number
  ): Promise<any> => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (categorie) params.append('categorie', categorie);
    if (lowStock) params.append('low_stock', 'true');
    if (locationId) params.append('location_id', locationId.toString());
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    params.append('sort', sort);
    params.append('order', order);
    const { data } = await api.get(`/produits?${params}`);
    return data;
  },

  getById: async (id: number): Promise<Produit> => {
    const { data } = await api.get(`/produits/${id}`);
    return data;
  },

  create: async (produit: CreateProduitPayload): Promise<{ id: number }> => {
    const { data } = await api.post('/produits', produit);
    return data;
  },

  update: async (id: number, produit: UpdateProduitPayload): Promise<void> => {
    await api.put(`/produits/${id}`, produit);
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/produits/${id}`);
  },

  adjustStock: async (id: number, quantite: number, location_id?: number): Promise<{ stock: number }> => {
    const { data } = await api.patch(`/produits/${id}/stock`, {
      quantite,
      ...(location_id ? { location_id } : {}),
    });
    return data;
  },

  getStockValuation: async (): Promise<any> => {
    const { data } = await api.get('/produits/stock-valuation');
    return data;
  },

  getStockByCategory: async (): Promise<any[]> => {
    const { data } = await api.get('/produits/stock-by-category');
    return data;
  },

  getStockHistory: async (id: number, limit = 50): Promise<any[]> => {
    const { data } = await api.get(`/produits/${id}/mouvements?limit=${limit}`);
    return data;
  },

  addStockMovement: async (id: number, movement: {
    type_mouvement: string;
    quantite: number;
    raison?: string;
    reference_liee?: string;
  }): Promise<{ stock: number }> => {
    const { data } = await api.post(`/produits/${id}/mouvements`, movement);
    return data;
  },

  searchFuzzy: async (query: string, limit = 10, threshold = 0.1): Promise<any[]> => {
    const params = new URLSearchParams();
    params.append('q', query);
    params.append('limit', limit.toString());
    params.append('threshold', threshold.toString());
    const { data } = await api.get(`/produits/search/fuzzy?${params}`);
    return data;
  },

  getSuggestions: async (query: string, limit = 5): Promise<any[]> => {
    const params = new URLSearchParams();
    params.append('q', query);
    params.append('limit', limit.toString());
    const { data } = await api.get(`/produits/suggestions?${params}`);
    return data;
  },
};

// ========== VENTES (Magasin-only product picker) ==========
// Used exclusively by Facture and Devis forms. Backend filters dépôt at SQL level
// and rejects non-magasin location_id with HTTP 422.
export const ventesService = {
  searchProducts: async (
    search?: string,
    page = 1,
    limit = 20,
    sort = 'nom',
    order = 'asc',
    locationId?: number,
  ): Promise<any> => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (locationId) params.append('location_id', locationId.toString());
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    params.append('sort', sort);
    params.append('order', order);
    const { data } = await api.get(`/produits/ventes?${params}`);
    return data;
  },

  getLocations: async (): Promise<any> => {
    const { data } = await api.get('/produits/ventes/locations');
    return data;
  },

  searchFuzzy: async (query: string, limit = 10, locationId?: number): Promise<any[]> => {
    const params = new URLSearchParams();
    params.append('q', query);
    params.append('limit', limit.toString());
    if (locationId) params.append('location_id', locationId.toString());
    const { data } = await api.get(`/produits/search/fuzzy?${params}`);
    // Filter by location stock if locationId is provided
    if (locationId && Array.isArray(data)) {
      return data.filter((p: any) => (p.stock || 0) > 0);
    }
    return data;
  },
};

// ========== TIERS (unified) ==========
export const tiersService = {
  getAll: async (options: {
    search?: string;
    role?: 'client' | 'fournisseur' | 'mixte' | 'all';
    page?: number;
    limit?: number;
    sort?: string;
    order?: string;
  } = {}): Promise<any> => {
    const params = new URLSearchParams();
    if (options.search) params.append('search', options.search);
    if (options.role) params.append('role', options.role);
    params.append('page', (options.page || 1).toString());
    params.append('limit', (options.limit || 20).toString());
    if (options.sort) params.append('sort', options.sort);
    if (options.order) params.append('order', options.order);
    const { data } = await api.get(`/tiers?${params}`);
    return data;
  },

  search: async (q: string, role?: 'client' | 'fournisseur'): Promise<any[]> => {
    const params = new URLSearchParams({ q });
    if (role) params.append('role', role);
    const { data } = await api.get(`/tiers/search?${params}`);
    return Array.isArray(data) ? data : data?.data || [];
  },

  getById: async (id: number): Promise<any> => {
    const { data } = await api.get(`/tiers/${id}`);
    return data;
  },

  getCompte: async (id: number, from?: string, to?: string): Promise<any> => {
    const params = new URLSearchParams();
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    const { data } = await api.get(`/tiers/${id}/compte?${params}`);
    return data;
  },

  create: async (payload: {
    raison_sociale: string;
    prenom?: string;
    telephone?: string;
    email?: string;
    adresse?: string;
    nif?: string;
    rccm?: string;
    est_client: boolean;
    est_fournisseur: boolean;
    credit_max?: number;
    delai_paiement?: string;
    delai_livraison?: number;
    notes?: string;
  }): Promise<any> => {
    const { data } = await api.post('/tiers', payload);
    return data;
  },

  update: async (id: number, payload: Record<string, any>): Promise<any> => {
    const { data } = await api.put(`/tiers/${id}`, payload);
    return data;
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/tiers/${id}`);
  },

  promouvoir: async (id: number, role: 'client' | 'fournisseur'): Promise<any> => {
    const { data } = await api.patch(`/tiers/${id}/promouvoir`, { role });
    return data;
  },

  recordAcompteClient: async (id: number, payload: {
    montant: number;
    methode_paiement: string;
    notes?: string;
    magasin_id?: number;
    reference_number?: string;
    idempotency_key?: string;
    session_caisse_id?: number;
  }): Promise<any> => {
    const { data } = await api.post(`/tiers/${id}/acomptes-client`, payload);
    return data;
  },

  recordAcompteFournisseur: async (id: number, payload: {
    montant: number;
    methode_paiement: string;
    notes?: string;
    magasin_id?: number;
    reference_number?: string;
    idempotency_key?: string;
    session_caisse_id?: number;
  }): Promise<any> => {
    const { data } = await api.post(`/tiers/${id}/acomptes-fournisseur`, payload);
    return data;
  },

  createCompensation: async (id: number, payload: {
    date_compensation: string;
    montant: number;
    notes?: string;
  }): Promise<any> => {
    const { data } = await api.post(`/tiers/${id}/compensation`, payload);
    return data;
  },

  getCompensations: async (id: number): Promise<any[]> => {
    const { data } = await api.get(`/tiers/${id}/compensations`);
    return Array.isArray(data) ? data : data?.data || [];
  },

  recomputeAllocation: async (id: number): Promise<any> => {
    const { data } = await api.post(`/tiers/${id}/recompute-allocation`);
    return data;
  },
};

// ========== ACOMPTES ==========
export const acompteService = {
  getById: async (id: number): Promise<any> => {
    const { data } = await api.get(`/acomptes/${id}`);
    return data?.data || data;
  },
  listApplications: async (id: number): Promise<any[]> => {
    const { data } = await api.get(`/acomptes/${id}/applications`);
    return data?.data || [];
  },
  apply: async (id: number, payload: { facture_id: number; montant: number; idempotency_key?: string }): Promise<any> => {
    const { data } = await api.post(`/acomptes/${id}/apply`, payload);
    return data;
  },
  refund: async (id: number, payload: {
    montant: number;
    methode_paiement: string;
    session_caisse_id?: number;
    notes?: string;
    idempotency_key?: string;
  }): Promise<any> => {
    const { data } = await api.post(`/acomptes/${id}/refund`, payload);
    return data;
  },
  listForClient: async (tiersId: number): Promise<any[]> => {
    // Reuses /api/comptes/:id/acomptes/disponibles for active-only list
    const { data } = await api.get(`/comptes/${tiersId}/acomptes/disponibles`);
    return data?.data || [];
  },
};

// ========== ACOMPTES FOURNISSEUR ==========
export const acompteFournisseurService = {
  getById: async (id: number): Promise<any> => {
    const { data } = await api.get(`/acomptes/fournisseur/${id}`);
    return data?.data || data;
  },
  listApplications: async (id: number): Promise<any[]> => {
    const { data } = await api.get(`/acomptes/fournisseur/${id}/applications`);
    return data?.data || [];
  },
  apply: async (id: number, payload: { facture_id: number; montant: number; idempotency_key?: string }): Promise<any> => {
    const { data } = await api.post(`/acomptes/fournisseur/${id}/apply`, payload);
    return data;
  },
  refund: async (id: number, payload: {
    montant: number;
    methode_paiement: string;
    session_caisse_id?: number;
    notes?: string;
    idempotency_key?: string;
  }): Promise<any> => {
    const { data } = await api.post(`/acomptes/fournisseur/${id}/refund`, payload);
    return data;
  },
  listForFournisseur: async (tiersId: number): Promise<any[]> => {
    const { data } = await api.get(`/tiers/${tiersId}/acomptes-fournisseur/disponibles`);
    return data?.data || [];
  },
};

// ========== CLIENTS ==========
export const clientService = {
  getAll: async (search?: string, page = 1, limit = 20, sort = 'nom', order = 'asc'): Promise<any> => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    params.append('sort', sort);
    params.append('order', order);
    const { data } = await api.get(`/clients?${params}`);
    return data;
  },

  getAllWithBalance: async (search?: string, page = 1, limit = 20, sort = 'nom', order = 'asc', statutSolde?: string): Promise<any> => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (statutSolde) params.append('statut_solde', statutSolde);
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    params.append('sort', sort);
    params.append('order', order);
    const { data } = await api.get(`/clients/with-balance?${params}`);
    return data;
  },

  getCompte: async (clientId: number, from?: string, to?: string): Promise<any> => {
    const params = new URLSearchParams();
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    const { data } = await api.get(`/clients/${clientId}/compte?${params}`);
    return data;
  },

  getById: async (id: number): Promise<Client> => {
    const { data } = await api.get(`/clients/${id}`);
    return data;
  },

  getHistorique: async (id: number): Promise<any[]> => {
    const { data } = await api.get(`/clients/${id}/historique`);
    return data;
  },

  create: async (client: Omit<Client, 'id'>): Promise<{ id: number }> => {
    const { data } = await api.post('/clients', client);
    return data;
  },

  update: async (id: number, client: Omit<Client, 'id'>): Promise<void> => {
    await api.put(`/clients/${id}`, client);
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/clients/${id}`);
  },
};

// ========== COMPTES CLIENTS ==========
export const compteClientService = {
  getBalance: async (clientId: number): Promise<any> => {
    const { data } = await api.get(`/comptes/${clientId}/solde`);
    return data;
  },

  getReleve: async (clientId: number, dateDebut?: string, dateFin?: string): Promise<any> => {
    const params = new URLSearchParams();
    if (dateDebut) params.append('date_debut', dateDebut);
    if (dateFin) params.append('date_fin', dateFin);
    const { data } = await api.get(`/comptes/${clientId}/releve?${params}`);
    return data;
  },

  getAging: async (clientId: number): Promise<any> => {
    const { data } = await api.get(`/comptes/${clientId}/aging`);
    return data;
  },

  recordAcompte: async (clientId: number, acompte: {
    montant: number;
    methode_paiement: string;
    notes?: string;
  }): Promise<any> => {
    const { data } = await api.post(`/comptes/${clientId}/acomptes`, acompte);
    return data;
  },

  getAcomptesDisponibles: async (clientId: number): Promise<any[]> => {
    const { data } = await api.get(`/comptes/${clientId}/acomptes/disponibles`);
    return data;
  },

  applyAcompte: async (clientId: number, factureId: number, acompteId: number): Promise<any> => {
    const { data } = await api.post(`/comptes/${clientId}/apply-acompte`, {
      facture_id: factureId,
      acompte_id: acompteId,
    });
    return data;
  },
};

// ========== FACTURES ==========
export const factureService = {
  getAll: async (search?: string, statut?: string, page = 1, limit = 20, sort = 'date_facture', order = 'desc'): Promise<any> => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (statut) params.append('statut', statut);
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    params.append('sort', sort);
    params.append('order', order);
    const { data } = await api.get(`/factures?${params}`);
    return data;
  },

  getById: async (id: number): Promise<FactureComplete> => {
    const { data } = await api.get(`/factures/${id}`);
    return data;
  },

  create: async (facture: {
    tiers_id: number;
    client_id?: number;
    location_id?: number;
    lignes: { produit_id: number; quantite: number; prix_unitaire: number }[];
    statut?: string;
    notes?: string;
  }): Promise<{ id: number; numero_facture: string; total: number }> => {
    const { data } = await api.post('/factures', facture);
    return data;
  },

  updateStatut: async (id: number, statut: string): Promise<void> => {
    await api.put(`/factures/${id}/statut`, { statut });
  },

  delete: async (id: number, restaurerStock = false): Promise<void> => {
    await api.delete(`/factures/${id}`, { data: { restaurer_stock: restaurerStock } });
  },

  getStats: async (): Promise<StatsDashboard> => {
    const { data } = await api.get('/factures/stats');
    // Unwrap nested data if needed
    return data.data || data;
  },

  getRevenueTrends: async (days = 30): Promise<any[]> => {
    const { data } = await api.get(`/factures/revenue-trends?days=${days}`);
    return data;
  },

  getTopProducts: async (limit = 5): Promise<any[]> => {
    const { data } = await api.get(`/factures/top-products?limit=${limit}`);
    return data;
  },

  getTopClients: async (limit = 5): Promise<any[]> => {
    const { data } = await api.get(`/factures/top-clients?limit=${limit}`);
    return data;
  },
};

// ========== PAIEMENTS ==========
export const paiementService = {
  create: async (factureId: number, paiement: {
    montant: number;
    methode_paiement: 'espece' | 'carte' | 'cheque' | 'virement';
    date_paiement?: string;
    reference?: string;
    notes?: string;
  }): Promise<{ id: number; message: string }> => {
    const { data } = await api.post(`/factures/${factureId}/paiements`, paiement);
    return data;
  },

  getByFacture: async (factureId: number): Promise<Paiement[]> => {
    const { data } = await api.get(`/factures/${factureId}/paiements`);
    return data;
  },

  getAll: async (page = 1, limit = 20, methode?: string, dateDebut?: string, dateFin?: string): Promise<any> => {
    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    if (methode) params.append('methode', methode);
    if (dateDebut) params.append('date_debut', dateDebut);
    if (dateFin) params.append('date_fin', dateFin);
    const { data } = await api.get(`/paiements?${params}`);
    return data;
  },

  getStats: async (): Promise<any> => {
    const { data } = await api.get('/paiements/stats');
    return data;
  },

  update: async (id: number, paiement: {
    montant?: number;
    methode_paiement?: 'espece' | 'carte' | 'cheque' | 'virement';
    reference?: string;
    notes?: string;
    date_paiement?: string;
  }): Promise<void> => {
    await api.put(`/paiements/${id}`, paiement);
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/paiements/${id}`);
  },
};

// ========== FOURNISSEURS ==========
export const fournisseurService = {
  getAll: async (search?: string, page: number = 1, limit: number = 20): Promise<any> => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    params.append('page', String(page));
    params.append('limit', String(limit));
    const { data } = await api.get(`/fournisseurs?${params}`);
    return data;
  },

  getById: async (id: number): Promise<any> => {
    const { data } = await api.get(`/fournisseurs/${id}`);
    return data;
  },

  create: async (fournisseur: any): Promise<{ id: number }> => {
    const { data } = await api.post('/fournisseurs', fournisseur);
    return data;
  },

  update: async (id: number, fournisseur: any): Promise<void> => {
    await api.put(`/fournisseurs/${id}`, fournisseur);
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/fournisseurs/${id}`);
  },
};

// ========== COMMANDES ==========
export const commandeService = {
  getAll: async (search?: string, statut?: string): Promise<any[]> => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (statut) params.append('statut', statut);
    const { data } = await api.get(`/commandes?${params}`);
    return data;
  },

  getById: async (id: number): Promise<any> => {
    const { data } = await api.get(`/commandes/${id}`);
    return data;
  },

  create: async (commande: {
    tiers_id: number;
    fournisseur_id?: number;
    lignes: { produit_id: number; quantite: number; prix_unitaire: number }[];
    notes?: string;
    date_livraison_prevue?: string;
  }): Promise<{ id: number; numero_commande: string }> => {
    const { data } = await api.post('/commandes', commande);
    return data;
  },

  updateStatut: async (id: number, statut: string): Promise<void> => {
    await api.put(`/commandes/${id}/statut`, { statut });
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/commandes/${id}`);
  },

  getStats: async (): Promise<any> => {
    const { data } = await api.get('/commandes/stats');
    return data;
  },
};

// ========== ERP MODULES ==========

// ========== RECEPTIONS ==========
export const receptionService = {
  getAll: async (search?: string, page = 1, limit = 20): Promise<any> => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    const { data } = await api.get(`/receptions?${params}`);
    return data;
  },

  getById: async (id: number): Promise<any> => {
    const { data } = await api.get(`/receptions/${id}`);
    return data;
  },

  create: async (reception: {
    commande_id: number;
    location_id?: number;
    lignes: { produit_id: number; quantite_commandee: number; quantite_recue: number; cout_unitaire: number; notes?: string }[];
    notes?: string;
  }): Promise<any> => {
    const { data } = await api.post('/receptions', reception);
    return data;
  },

  getPending: async (): Promise<any[]> => {
    const { data } = await api.get('/receptions/pending');
    return data;
  },

  getOrderDetails: async (commandeId: number): Promise<any> => {
    const { data } = await api.get(`/receptions/order/${commandeId}`);
    return data;
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/receptions/${id}`);
  },

  getStats: async (): Promise<any> => {
    const { data } = await api.get('/receptions/stats');
    return data;
  },
};

// ========== STOCK LOCATIONS ==========
export const stockLocationService = {
  getAll: async (): Promise<any> => {
    const { data } = await api.get('/stock-locations');
    return data;
  },

  getById: async (id: number): Promise<any> => {
    const { data } = await api.get(`/stock-locations/${id}`);
    return data;
  },

  create: async (location: {
    code: string;
    nom: string;
    adresse?: string;
    responsable_id?: number;
    est_principal?: boolean;
  }): Promise<any> => {
    const { data } = await api.post('/stock-locations', location);
    return data;
  },

  getStockLevels: async (locationId: number): Promise<any> => {
    const { data } = await api.get(`/stock-locations/${locationId}/stock`);
    return data;
  },

  getProductsWithStock: async (locationId: number, search?: string, limit?: number): Promise<any> => {
    const params: Record<string, any> = {};
    if (search) params.search = search;
    if (limit) params.limit = limit;
    const { data } = await api.get(`/stock-locations/${locationId}/products-with-stock`, { params });
    return data;
  },
};

// ========== USER LOCATION ASSIGNMENTS ==========
export const userLocationAssignmentService = {
  getUsers: async (): Promise<any> => {
    const { data } = await api.get('/user-location-assignments/users');
    return data;
  },

  getLocations: async (): Promise<any> => {
    const { data } = await api.get('/user-location-assignments/locations');
    return data;
  },

  getByUserId: async (userId: number): Promise<any> => {
    const { data } = await api.get(`/user-location-assignments/${userId}`);
    return data;
  },

  update: async (userId: number, payload: { location_ids: number[]; default_location_id?: number | null }): Promise<any> => {
    const { data } = await api.put(`/user-location-assignments/${userId}`, payload);
    return data;
  },
};

// ========== STOCK TRANSFERS ==========
export const stockTransferService = {
  getAll: async (search?: string, statut?: string, page = 1, limit = 20): Promise<any> => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (statut) params.append('statut', statut);
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    const { data } = await api.get(`/stock-transfers?${params}`);
    return data;
  },

  getById: async (id: number): Promise<any> => {
    const { data } = await api.get(`/stock-transfers/${id}`);
    return data;
  },

  create: async (transfer: {
    location_source_id: number;
    location_destination_id: number;
    lignes: { produit_id: number; quantite_demandee: number }[];
    notes?: string;
  }): Promise<any> => {
    const { data } = await api.post('/stock-transfers', transfer);
    return data;
  },

  complete: async (id: number): Promise<void> => {
    await api.post(`/stock-transfers/${id}/complete`);
  },
};

// ========== INTERNAL STOCK REQUESTS ==========
export const internalStockRequestService = {
  getAll: async (filters?: {
    statut?: string;
    magasin_id?: number;
    depot_id?: number;
    page?: number;
    limit?: number;
  }): Promise<any> => {
    const params = new URLSearchParams();
    if (filters?.statut) params.append('statut', filters.statut);
    if (filters?.magasin_id) params.append('magasin_id', String(filters.magasin_id));
    if (filters?.depot_id) params.append('depot_id', String(filters.depot_id));
    params.append('page', String(filters?.page || 1));
    params.append('limit', String(filters?.limit || 20));
    const { data } = await api.get(`/internal-stock-requests?${params}`);
    return data;
  },

  getById: async (id: number): Promise<any> => {
    const { data } = await api.get(`/internal-stock-requests/${id}`);
    return data;
  },

  create: async (payload: {
    magasin_id: number;
    depot_id: number;
    lignes: { produit_id: number; quantite_demandee: number }[];
    notes?: string;
  }): Promise<any> => {
    const { data } = await api.post('/internal-stock-requests', payload);
    return data;
  },

  validate: async (id: number, lignes?: { produit_id: number; quantite_validee: number }[]): Promise<void> => {
    await api.post(`/internal-stock-requests/${id}/validate`, { lignes });
  },

  reject: async (id: number, motifRefus?: string): Promise<void> => {
    await api.post(`/internal-stock-requests/${id}/reject`, { motif_refus: motifRefus });
  },

  execute: async (id: number): Promise<any> => {
    const { data } = await api.post(`/internal-stock-requests/${id}/execute`);
    return data;
  },
};

// ========== FACTURES FOURNISSEUR ==========
export const factureFournisseurService = {
  getAll: async (search?: string, statut?: string, fournisseur_id?: number, page = 1, limit = 20): Promise<any> => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (statut) params.append('statut', statut);
    if (fournisseur_id) params.append('fournisseur_id', fournisseur_id.toString());
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    const { data } = await api.get(`/factures-fournisseur?${params}`);
    return data;
  },

  getById: async (id: number): Promise<any> => {
    const { data } = await api.get(`/factures-fournisseur/${id}`);
    return data;
  },

  create: async (facture: {
    tiers_id: number;
    fournisseur_id?: number;
    reception_id?: number;
    numero_facture_fournisseur: string;
    date_facture: string;
    date_echeance?: string;
    condition_paiement?: string;
    lignes: { produit_id?: number | null; description?: string; quantite: number; prix_unitaire: number; tva_taux?: number }[];
    notes?: string;
  }): Promise<any> => {
    const { data } = await api.post('/factures-fournisseur', facture);
    return data;
  },

  recordPayment: async (factureId: number, payment: {
    montant: number;
    methode_paiement: string;
    reference?: string;
  }): Promise<void> => {
    await api.post(`/factures-fournisseur/${factureId}/paiement`, payment);
  },

  getPayable: async (): Promise<any[]> => {
    const { data } = await api.get('/factures-fournisseur/payable');
    return data;
  },

  getStats: async (): Promise<any> => {
    const { data } = await api.get('/factures-fournisseur/stats');
    return data;
  },
};

// ========== GENERAL LEDGER ==========
export const generalLedgerService = {
  getAll: async (journal?: string, date_debut?: string, date_fin?: string, compte_id?: number, page = 1, limit = 50): Promise<any> => {
    const params = new URLSearchParams();
    if (journal) params.append('journal', journal);
    if (date_debut) params.append('date_debut', date_debut);
    if (date_fin) params.append('date_fin', date_fin);
    if (compte_id) params.append('compte_id', compte_id.toString());
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    const { data } = await api.get(`/general-ledger?${params}`);
    return data;
  },

  getChartOfAccounts: async (actifOnly = true): Promise<any> => {
    const { data } = await api.get(`/general-ledger/chart-of-accounts?actif_only=${actifOnly}`);
    return data;
  },

  getTrialBalance: async (dateDebut: string, dateFin: string): Promise<any> => {
    const { data } = await api.get('/general-ledger/trial-balance', {
      params: { date_debut: dateDebut, date_fin: dateFin }
    });
    return data;
  },

  getAccountLedger: async (compteId: number, dateDebut: string, dateFin: string): Promise<any> => {
    const { data } = await api.get(`/general-ledger/account/${compteId}/ledger`, {
      params: { date_debut: dateDebut, date_fin: dateFin }
    });
    return data;
  },

  createManualEntry: async (entry: {
    numero_piece: string;
    journal: string;
    date_ecriture: string;
    lignes: { compte_id: number; debit: number; credit: number; description?: string }[];
  }): Promise<void> => {
    await api.post('/general-ledger/manual-entry', entry);
  },

  getStats: async (date_debut?: string, date_fin?: string): Promise<any> => {
    const params: any = {};
    if (date_debut) params.date_debut = date_debut;
    if (date_fin) params.date_fin = date_fin;
    const { data } = await api.get('/general-ledger/stats', { params });
    return data;
  },

  getJournalBreakdown: async (dateDebut: string, dateFin: string): Promise<any> => {
    const { data } = await api.get('/general-ledger/journal-breakdown', {
      params: { date_debut: dateDebut, date_fin: dateFin }
    });
    return data;
  },
};

// ========== EMPLOYES ==========
export const employeService = {
  getAll: async (search?: string, departement?: string, actif?: boolean, page = 1, limit = 20): Promise<any> => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (departement) params.append('departement', departement);
    if (actif !== undefined) params.append('actif', actif.toString());
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    const { data } = await api.get(`/employes?${params}`);
    return data;
  },

  getById: async (id: number): Promise<any> => {
    const { data } = await api.get(`/employes/${id}`);
    return data;
  },

  create: async (employe: {
    matricule: string;
    nom_complet: string;
    poste?: string;
    departement?: string;
    date_embauche: string;
    date_naissance?: string;
    telephone?: string;
    email?: string;
    adresse?: string;
    salaire_base?: number;
    commission_taux?: number;
  }): Promise<any> => {
    const { data } = await api.post('/employes', employe);
    return data;
  },

  recordCommission: async (employeId: number, factureId: number, montantVente: number): Promise<void> => {
    await api.post(`/employes/${employeId}/commission`, {
      facture_id: factureId,
      montant_vente: montantVente,
    });
  },

  getCommissionSummary: async (employeId: number, dateDebut: string, dateFin: string): Promise<any> => {
    const { data } = await api.get(`/employes/${employeId}/commission-summary`, {
      params: { date_debut: dateDebut, date_fin: dateFin }
    });
    return data;
  },

  recordShift: async (shift: {
    employe_id: number;
    date_shift: string;
    heure_prevue_debut?: string;
    heure_prevue_fin?: string;
    heure_debut?: string;
    heure_fin?: string;
    statut?: string;
    notes?: string;
  }): Promise<void> => {
    await api.post('/employes/shifts', shift);
  },

  getStats: async (): Promise<any> => {
    const { data } = await api.get('/employes/stats');
    return data;
  },
};


// ========== DEVIS ==========
export const devisService = {
  getAll: async (search?: string, statut?: string, page = 1, limit = 20): Promise<any> => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (statut) params.append('statut', statut);
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    const { data } = await api.get(`/devis?${params}`);
    return data.data || data;
  },

  getById: async (id: number): Promise<any> => {
    const { data } = await api.get(`/devis/${id}`);
    return data;
  },

  create: async (devis: {
    tiers_id: number;
    client_id?: number;
    location_id?: number;
    lignes: { produit_id: number; quantite: number; prix_unitaire: number }[];
    notes?: string;
    valid_until?: string;
  }): Promise<any> => {
    const { data } = await api.post('/devis', devis);
    return data;
  },

  updateStatut: async (id: number, statut: string): Promise<void> => {
    await api.patch(`/devis/${id}/statut`, { statut });
  },

  convertToFacture: async (id: number): Promise<any> => {
    const { data } = await api.post(`/devis/${id}/convert`);
    return data;
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/devis/${id}`);
  },
};

// ========== BONS DE LIVRAISON ==========
export const bonLivraisonService = {
  getAll: async (search?: string, statut?: string, page = 1, limit = 20): Promise<any> => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (statut) params.append('statut', statut);
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    const { data } = await api.get(`/bons-livraison?${params}`);
    return data;
  },

  getById: async (id: number): Promise<any> => {
    const { data } = await api.get(`/bons-livraison/${id}`);
    return data;
  },

  create: async (bon: {
    tiers_id: number;
    client_id?: number;
    devis_id: number;
    lignes: { produit_id: number; quantite_commandee: number; quantite_livree?: number; prix_unitaire: number }[];
    notes?: string;
  }): Promise<any> => {
    const { data } = await api.post('/bons-livraison', bon);
    return data;
  },

  updateStatut: async (id: number, statut: string): Promise<void> => {
    await api.patch(`/bons-livraison/${id}/statut`, { statut });
  },

  convertToFacture: async (id: number): Promise<any> => {
    const { data } = await api.post(`/bons-livraison/${id}/convert`);
    return data;
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/bons-livraison/${id}`);
  },
};

// ========== AVOIRS (CREDIT NOTES) ==========
export const creditNoteService = {
  getAll: async (search?: string, page = 1, limit = 20): Promise<any> => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    const { data } = await api.get(`/avoirs?${params}`);
    return data;
  },

  getById: async (id: number): Promise<any> => {
    const { data } = await api.get(`/avoirs/${id}`);
    return data;
  },

  createFromRetour: async (retourId: number): Promise<any> => {
    const { data } = await api.post('/avoirs/from-retour', { retour_id: retourId });
    return data;
  },

  createManual: async (avoir: {
    tiers_id: number;
    client_id?: number;
    facture_origine_id: number;
    lignes: { produit_id?: number; description?: string; quantite: number; prix_unitaire: number }[];
    avoir_type?: 'retour' | 'echange' | 'remise_commerciale' | 'erreur';
    notes?: string;
  }): Promise<any> => {
    const { data } = await api.post('/avoirs/manual', avoir);
    return data;
  },

  updateStatut: async (id: number, statut: string): Promise<void> => {
    await api.patch(`/avoirs/${id}/statut`, { statut });
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/avoirs/${id}`);
  },
};

// ========== CAISSE ==========
export const caisseService = {
  getCurrentSession: async (): Promise<any> => {
    const { data } = await api.get('/caisse/current');
    return data;
  },

  getSessions: async (): Promise<any> => {
    const { data } = await api.get('/caisse/sessions');
    return data;
  },

  openSession: async (solde_initial: number): Promise<any> => {
    const { data } = await api.post('/caisse/open', { solde_ouverture: solde_initial });
    return data;
  },

  closeSession: async (sessionId: number, solde_final: number): Promise<any> => {
    const { data } = await api.post(`/caisse/${sessionId}/close`, { solde_fermeture: solde_final });
    return data;
  },

  getZReport: async (sessionId: number): Promise<any> => {
    const { data } = await api.get(`/caisse/${sessionId}/report`);
    return data;
  },

  getSessionPaiements: async (sessionId: number): Promise<any> => {
    const { data } = await api.get(`/caisse/${sessionId}/paiements`);
    return data;
  },

  getAudit: async (params: {
    orphans_only?: boolean;
    source_kind?: string;
    tiers_id?: number;
    date_from?: string;
    date_to?: string;
    limit?: number;
  } = {}): Promise<{ data: any[]; summary: any[]; orphans_total: number }> => {
    const q = new URLSearchParams();
    if (params.orphans_only) q.set('orphans_only', 'true');
    if (params.source_kind) q.set('source_kind', params.source_kind);
    if (params.tiers_id) q.set('tiers_id', String(params.tiers_id));
    if (params.date_from) q.set('date_from', params.date_from);
    if (params.date_to) q.set('date_to', params.date_to);
    if (params.limit) q.set('limit', String(params.limit));
    const { data } = await api.get(`/caisse/audit?${q.toString()}`);
    return data;
  },
};

// ========== DEPENSES ==========
export const depenseService = {
  getAll: async (search?: string, categorie?: string, page = 1, limit = 20): Promise<any> => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (categorie) params.append('categorie', categorie);
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    const { data } = await api.get(`/depenses?${params}`);
    return data;
  },

  getById: async (id: number): Promise<any> => {
    const { data } = await api.get(`/depenses/${id}`);
    return data;
  },

  create: async (depense: {
    montant: number;
    categorie_id: number;
    description: string;
    methode_paiement?: string;
    reference?: string;
    notes?: string;
  }): Promise<any> => {
    const { data } = await api.post('/depenses', depense);
    return data;
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/depenses/${id}`);
  },

  getCategories: async (): Promise<any[]> => {
    const { data } = await api.get('/depenses/categories');
    return data;
  },

  getStats: async (dateDebut?: string, dateFin?: string): Promise<any> => {
    const params: any = {};
    if (dateDebut) params.date_debut = dateDebut;
    if (dateFin) params.date_fin = dateFin;
    const { data } = await api.get('/depenses/stats', { params });
    return data;
  },
};

// ========== POS (POINT OF SALE) ==========
export const posService = {
  getCurrentSession: async (): Promise<any> => {
    const { data } = await api.get('/pos/session');
    return data;
  },

  openSession: async (solde_initial: number, location_id?: number): Promise<any> => {
    const { data } = await api.post('/pos/open', { solde_ouverture: solde_initial, location_id });
    return data;
  },

  closeSession: async (sessionId: number, solde_final?: number): Promise<any> => {
    const { data } = await api.post(`/pos/${sessionId}/close`, { solde_cloture: solde_final });
    return data;
  },

  getSessionSummary: async (sessionId: number): Promise<any> => {
    const { data } = await api.get(`/pos/${sessionId}/summary`);
    return data;
  },

  scanBarcode: async (codeBarre: string): Promise<any> => {
    const { data } = await api.get(`/pos/scan?code_barre=${codeBarre}`);
    return data;
  },

  quickSale: async (sessionId: number, items: {
    produit_id: number;
    quantite: number;
    prix_unitaire: number;
  }[], client_id?: number, methode_paiement?: string): Promise<any> => {
    const { data } = await api.post('/pos/sale', {
      sessionId,
      items,
      client_id,
      methode_paiement,
    });
    return data;
  },
};

// ========== DEMANDES DE REAPPROVISIONNEMENT (New RBC Workflow) ==========
export const demandeService = {
  getAll: async (filters?: {
    statut?: string;
    magasin_id?: number;
    depot_id?: number;
    date_from?: string;
    date_to?: string;
    page?: number;
    limit?: number;
  }): Promise<any> => {
    const params = new URLSearchParams();
    if (filters?.statut) params.append('statut', filters.statut);
    if (filters?.magasin_id) params.append('magasin_id', String(filters.magasin_id));
    if (filters?.depot_id) params.append('depot_id', String(filters.depot_id));
    if (filters?.date_from) params.append('date_from', filters.date_from);
    if (filters?.date_to) params.append('date_to', filters.date_to);
    params.append('page', String(filters?.page || 1));
    params.append('limit', String(filters?.limit || 20));
    const { data } = await api.get(`/demandes?${params}`);
    return data;
  },

  getById: async (id: number): Promise<any> => {
    const { data } = await api.get(`/demandes/${id}`);
    return data;
  },

  create: async (payload: {
    magasin_id: number;
    depot_id: number;
    lignes: { produit_id: number; quantite_demandee: number; notes?: string }[];
    motif?: string;
  }): Promise<any> => {
    const { data } = await api.post('/demandes', payload);
    return data;
  },

  update: async (id: number, payload: {
    lignes?: { produit_id: number; quantite_demandee: number; notes?: string }[];
    motif?: string;
  }): Promise<any> => {
    const { data } = await api.put(`/demandes/${id}`, payload);
    return data;
  },

  send: async (id: number): Promise<any> => {
    const { data } = await api.post(`/demandes/${id}/envoyer`);
    return data;
  },

  decide: async (id: number, payload: {
    decision: 'approuvee' | 'refusee';
    lignes_decision?: { ligne_id: number; quantite_approuvee: number }[];
    raison_refus?: string;
  }): Promise<any> => {
    const { data } = await api.post(`/demandes/${id}/decider`, payload);
    return data;
  },

  execute: async (id: number): Promise<any> => {
    const { data } = await api.post(`/demandes/${id}/executer`);
    return data;
  },

  close: async (id: number): Promise<any> => {
    const { data } = await api.post(`/demandes/${id}/cloturer`);
    return data;
  },

  cancel: async (id: number): Promise<any> => {
    const { data } = await api.post(`/demandes/${id}/annuler`);
    return data;
  },

  getDepotStock: async (depot_id: number, search?: string): Promise<any> => {
    const params = new URLSearchParams();
    params.append('depot_id', String(depot_id));
    if (search) params.append('search', search);
    const { data } = await api.get(`/demandes/stock/depot?${params}`);
    return data;
  },
};

// ========== ADMIN USER MANAGEMENT ==========
export const adminUserService = {
  getAll: async (page = 1, limit = 20): Promise<any> => {
    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    const { data } = await api.get(`/admin/users?${params}`);
    return data;
  },

  getRoles: async (): Promise<any[]> => {
    const { data } = await api.get('/admin/users/roles');
    return data?.data || data;
  },

  getPermissions: async (): Promise<any[]> => {
    const { data } = await api.get('/admin/users/permissions');
    return data?.data || data;
  },

  create: async (user: any): Promise<any> => {
    const { data } = await api.post('/admin/users', user);
    return data;
  },

  update: async (id: number, user: any): Promise<any> => {
    const { data } = await api.put(`/admin/users/${id}`, user);
    return data;
  },

  getUserPermissions: async (id: number): Promise<any> => {
    const { data } = await api.get(`/admin/users/${id}/permissions`);
    return data?.data || data;
  },

  updateUserPermissions: async (id: number, payload: { customiser_permissions: boolean, permission_ids: number[] }): Promise<any> => {
    const { data } = await api.post(`/admin/users/${id}/permissions`, payload);
    return data;
  },
};
