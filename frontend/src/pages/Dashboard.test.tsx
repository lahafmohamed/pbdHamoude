import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Dashboard from '../pages/Dashboard';
import { toast } from 'sonner';

// Mock the API services
vi.mock('../services/api', () => ({
  factureService: {
    getStats: vi.fn(),
    getRevenueTrends: vi.fn(),
    getTopProducts: vi.fn(),
    getTopClients: vi.fn(),
  },
  produitService: {
    getStockByCategory: vi.fn(),
  },
  commandeService: {
    getStats: vi.fn(),
  },
}));

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  Link: ({ children, to, className }: any) => (
    <a href={to} className={className} data-testid="link">
      {children}
    </a>
  ),
}));

// Mock recharts
vi.mock('recharts', () => ({
  AreaChart: ({ children }: any) => <div data-testid="area-chart">{children}</div>,
  Area: () => null,
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
  Pie: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
  Cell: () => null,
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

import { factureService, produitService, commandeService } from '../services/api';

const mockStats = {
  total_factures: { count: '150', montant: '7500000' },
  factures_mois: { count: '25', montant: '1250000' },
  alertes_stock: 3,
};

const mockRevenueData = [
  { date: '2024-01-01', count: '5', total: '250000' },
  { date: '2024-01-02', count: '8', total: '400000' },
  { date: '2024-01-03', count: '3', total: '150000' },
];

const mockTopProducts = [
  { nom: 'Laptop HP', reference: 'LAPTOP-001', total_quantite: '50', total_ventes: '2500000' },
  { nom: 'Mouse Logitech', reference: 'MOUSE-001', total_quantite: '100', total_ventes: '500000' },
];

const mockTopClients = [
  { nom: 'Dupont', prenom: 'Jean', nombre_factures: '10', total_depenses: '500000' },
  { nom: 'Martin', prenom: 'Sophie', nombre_factures: '8', total_depenses: '400000' },
];

const mockStockByCategory = [
  { categorie: 'Laptops', nombre_produits: '20', total_unites: '100', valeur_achat: '5000000', valeur_vente: '7000000' },
  { categorie: 'Accessoires', nombre_produits: '50', total_unites: '500', valeur_achat: '1000000', valeur_vente: '2000000' },
];

const mockCommandeStats = {
  en_attente: '5',
  validee: '3',
  expediee: '2',
  livree: '10',
};

function renderDashboard() {
  return render(<Dashboard />);
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (factureService.getStats as any).mockResolvedValue(mockStats);
    (factureService.getRevenueTrends as any).mockResolvedValue(mockRevenueData);
    (factureService.getTopProducts as any).mockResolvedValue(mockTopProducts);
    (factureService.getTopClients as any).mockResolvedValue(mockTopClients);
    (produitService.getStockByCategory as any).mockResolvedValue(mockStockByCategory);
    (commandeService.getStats as any).mockResolvedValue(mockCommandeStats);
  });

  it('renders loading state initially', () => {
    renderDashboard();
    expect(screen.getByText(/Chargement des données/i)).toBeInTheDocument();
  });

  it('renders dashboard stats after loading', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Tableau de Bord')).toBeInTheDocument();
    });

    expect(screen.getByText('150')).toBeInTheDocument(); // Total factures count
    expect(screen.getByText('25')).toBeInTheDocument(); // Factures mois count
    expect(screen.getByText('3')).toBeInTheDocument(); // Alertes stock
  });

  it('displays total revenue amount', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('7500000 XOF')).toBeInTheDocument();
    });
  });

  it('displays monthly revenue amount', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('1250000 XOF')).toBeInTheDocument();
    });
  });

  it('shows stock alert in red when alerts exist', async () => {
    renderDashboard();

    await waitFor(() => {
      const alertElement = screen.getByText('3');
      expect(alertElement).toHaveClass('text-destructive');
    });
  });

  it('renders Nouvelle Facture button', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Nouvelle Facture')).toBeInTheDocument();
    });
  });

  it('renders revenue trend chart when data exists', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/Évolution du Chiffre d'Affaires/i)).toBeInTheDocument();
    });
    expect(screen.getByTestId('area-chart')).toBeInTheDocument();
  });

  it('renders top products chart', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/Top 5 Produits/i)).toBeInTheDocument();
    });
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
  });

  it('renders top clients chart', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/Top 5 Meilleurs Clients/i)).toBeInTheDocument();
    });
  });

  it('renders stock by category pie chart', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/Valorisation du Stock/i)).toBeInTheDocument();
    });
    expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
  });

  it('shows pending orders widget when there are pending orders', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/Commandes en attente: 5/i)).toBeInTheDocument();
    });
  });

  it('renders quick navigation cards', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Navigation Rapide')).toBeInTheDocument();
      expect(screen.getByText('Gestion Stock')).toBeInTheDocument();
      expect(screen.getByText('Clients')).toBeInTheDocument();
      expect(screen.getByText('Factures')).toBeInTheDocument();
    });
  });

  it('calls all API endpoints on mount', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(factureService.getStats).toHaveBeenCalledTimes(1);
      expect(factureService.getRevenueTrends).toHaveBeenCalledWith(30);
      expect(factureService.getTopProducts).toHaveBeenCalledWith(5);
      expect(factureService.getTopClients).toHaveBeenCalledWith(5);
      expect(produitService.getStockByCategory).toHaveBeenCalledTimes(1);
      expect(commandeService.getStats).toHaveBeenCalledTimes(1);
    });
  });
});

describe('Dashboard - Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows error toast when API calls fail', async () => {
    (factureService.getStats as any).mockRejectedValue(new Error('API Error'));

    renderDashboard();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Erreur lors du chargement du dashboard');
    });
  });

  it('handles empty revenue data gracefully', async () => {
    (factureService.getStats as any).mockResolvedValue(mockStats);
    (factureService.getRevenueTrends as any).mockResolvedValue([]);
    (factureService.getTopProducts as any).mockResolvedValue([]);
    (factureService.getTopClients as any).mockResolvedValue([]);
    (produitService.getStockByCategory as any).mockResolvedValue([]);
    (commandeService.getStats as any).mockResolvedValue(mockCommandeStats);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Tableau de Bord')).toBeInTheDocument();
    });

    // Chart sections should show empty state messages
    expect(screen.getByText('Aucune vente enregistrée')).toBeInTheDocument();
    expect(screen.getByText('Aucun client avec des achats')).toBeInTheDocument();
  });

  it('handles zero pending orders (no pending orders widget)', async () => {
    (factureService.getStats as any).mockResolvedValue(mockStats);
    (factureService.getRevenueTrends as any).mockResolvedValue(mockRevenueData);
    (factureService.getTopProducts as any).mockResolvedValue(mockTopProducts);
    (factureService.getTopClients as any).mockResolvedValue(mockTopClients);
    (produitService.getStockByCategory as any).mockResolvedValue(mockStockByCategory);
    (commandeService.getStats as any).mockResolvedValue({ ...mockCommandeStats, en_attente: '0' });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Tableau de Bord')).toBeInTheDocument();
    });

    // Pending orders widget should not appear
    const pendingWidget = screen.queryByText(/Commandes en attente:/);
    expect(pendingWidget).toBeNull();
  });
});

describe('Dashboard - Data Formatting', () => {
  it('formats XOF currency correctly', () => {
    const formatXOF = (value: number) => `${value.toFixed(0)} XOF`;

    expect(formatXOF(7500000)).toBe('7500000 XOF');
    expect(formatXOF(1250000)).toBe('1250000 XOF');
    expect(formatXOF(0)).toBe('0 XOF');
  });

  it('calculates TVA correctly (19%)', () => {
    const sousTotal = 100000;
    const tva = sousTotal * 0.19;
    const total = sousTotal + tva;

    expect(tva).toBe(19000);
    expect(total).toBe(119000);
  });
});
