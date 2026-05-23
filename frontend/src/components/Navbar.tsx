import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { 
  LayoutDashboard, 
  Package, 
  Users, 
  FileText, 
  TrendingUp, 
  ShoppingCart, 
  Truck, 
  LogOut, 
  User, 
  Menu, 
  X, 
  MapPin,
  ArrowLeftRight,
  FileBarChart,
  BookOpen,
  UserCheck,
  FilePlus,
  FileCheck,
  FileX,
  Wallet,
  Receipt,
  ChevronDown,
  ClipboardList,
  ShieldCheck,
  KeyRound
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { NotificationBell } from './NotificationBell';

interface NavItem {
  path: string;
  label: string;
  icon: any;
}

interface NavCategory {
  label: string;
  icon: any;
  items: NavItem[];
}

export default function Navbar() {
  const location = useLocation();
  const { user, logout, hasRole } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isAdminOrManager = hasRole('admin', 'manager');
  const isDepotStaff = hasRole('depot_staff');
  const isMagasinStaff = hasRole('magasin_staff');
  const isCaissier = hasRole('caissier');

  // Categorized navigation — filtered by role
  const navCategories: NavCategory[] = [
    // Ventes: magasin_staff, caissier, admin, manager
    ...((isAdminOrManager || isMagasinStaff || isCaissier) ? [{
      label: 'Ventes',
      icon: FileText,
      items: [
        { path: '/factures', label: 'Factures', icon: FileText },
        { path: '/devis', label: 'Devis', icon: FilePlus },
        { path: '/bons-livraison', label: 'Bons de Livraison', icon: FileCheck },
        ...((isAdminOrManager) ? [
          { path: '/avoirs', label: 'Avoirs', icon: FileX },
        ] : []),
      ],
    }] : []),

    // Achats: depot_staff, admin, manager
    ...((isAdminOrManager || isDepotStaff) ? [{
      label: 'Achats',
      icon: ShoppingCart,
      items: [
        { path: '/commandes', label: 'Commandes', icon: ShoppingCart },
        { path: '/receptions', label: 'Réceptions', icon: Truck },
        { path: '/factures-fournisseur', label: 'Factures Fourn.', icon: FileBarChart },
      ],
    }] : []),

    // Contacts (tiers): admin, manager only
    ...((isAdminOrManager) ? [{
      label: 'Contacts',
      icon: Users,
      items: [
        { path: '/tiers', label: 'Contacts', icon: UserCheck },
        { path: '/employes', label: 'Employés', icon: UserCheck },
      ],
    }] : []),

    // Stock: all except viewer/caissier see basic stock; depot_staff sees transfers & demandes
    {
      label: 'Stock',
      icon: Package,
      items: [
        { path: '/inventaire', label: 'Inventaire', icon: Package },
        ...((isAdminOrManager || isDepotStaff) ? [
          { path: '/stock-locations', label: 'Locations', icon: MapPin },
          { path: '/stock-transfers', label: 'Transferts', icon: ArrowLeftRight },
          { path: '/demandes', label: 'Demandes Réappro', icon: ClipboardList },
        ] : []),
        ...((isMagasinStaff || isCaissier) ? [
          { path: '/demandes', label: 'Demandes Réappro', icon: ClipboardList },
        ] : []),
        ...((isAdminOrManager) ? [
          { path: '/affectations-locations', label: 'Affectations', icon: UserCheck },
          { path: '/stock-valuation', label: 'Valuation', icon: TrendingUp },
        ] : []),
      ],
    },

    // Finance: magasin_staff and caissier see caisse+dépenses; admin/manager see everything
    {
      label: 'Finance',
      icon: Wallet,
      items: [
        ...((isAdminOrManager || isCaissier || isMagasinStaff) ? [{ path: '/caisse', label: 'Caisse', icon: Wallet }] : []),
        ...((isAdminOrManager || isCaissier || isMagasinStaff) ? [{ path: '/depenses', label: 'Dépenses', icon: Receipt }] : []),
        ...((isAdminOrManager) ? [
          { path: '/caisse/audit', label: 'Audit caisse', icon: ShieldCheck },
          { path: '/general-ledger', label: 'Comptabilité', icon: BookOpen },
          { path: '/reporting', label: 'Rapports', icon: TrendingUp },
        ] : []),
      ],
    },

    // Admin: admin only
    ...((hasRole('admin')) ? [{
      label: 'Admin',
      icon: ShieldCheck,
      items: [
        { path: '/admin/users', label: 'Utilisateurs', icon: Users },
        { path: '/admin/permissions', label: 'Permissions', icon: KeyRound },
      ],
    }] : []),
  ].filter(cat => cat.items.length > 0);

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b bg-background">
        <div className="flex h-12 sm:h-14 items-center gap-1.5 px-2 sm:px-4">
          {/* Mobile menu toggle */}
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden h-8 w-8 p-0"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>

          <Link to="/" className="flex items-center space-x-2">
            <img
              src="/logo.png"
              alt="PBD SARL"
              className="h-8 sm:h-10 w-auto object-contain"
            />
            <span className="font-semibold text-sm sm:text-base hidden sm:inline-block">PBD SARL</span>
          </Link>

          {/* Desktop navigation */}
          <nav className="hidden lg:flex items-center gap-1 ml-2">
            {/* Dashboard - standalone */}
            <Link to="/">
              <Button
                variant={location.pathname === '/' ? "default" : "ghost"}
                size="sm"
                className="h-8 px-2"
                title="Dashboard"
              >
                <LayoutDashboard className="h-4 w-4" />
              </Button>
            </Link>

            {/* Categorized dropdowns */}
            {navCategories.map((category) => {
              const CategoryIcon = category.icon;
              const hasActiveItem = category.items.some(item => location.pathname === item.path);
              
              return (
                <DropdownMenu key={category.label}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant={hasActiveItem ? "default" : "ghost"}
                      size="sm"
                      className="h-8 px-2 gap-1"
                    >
                      <CategoryIcon className="h-4 w-4" />
                      <span className="hidden xl:inline text-xs">{category.label}</span>
                      <ChevronDown className="h-3 w-3 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    {category.items.map((item) => {
                      const ItemIcon = item.icon;
                      const isActive = location.pathname === item.path;
                      return (
                        <DropdownMenuItem key={item.path} asChild>
                          <Link to={item.path} className="flex items-center gap-2 w-full">
                            <ItemIcon className="h-4 w-4" />
                            <span>{item.label}</span>
                            {isActive && (
                              <span className="ml-auto text-xs text-primary">●</span>
                            )}
                          </Link>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            })}
          </nav>

          {/* Spacer */}
          <div className="flex-1 lg:flex-none" />

          {/* User section */}
          {user && (
            <div className="flex items-center gap-1">
              <NotificationBell />
              <div className="flex items-center gap-1.5 px-1.5 py-0.5 text-xs">
                <User className="h-3.5 w-3.5" />
                <span className="hidden lg:inline text-xs">{user.username}</span>
                <span className="inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {user.role}
                </span>
              </div>
              <Button variant="ghost" size="sm" onClick={logout} className="gap-1 text-danger-600 hover:text-danger-700 hover:bg-danger-50 px-2 h-8">
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden lg:inline text-xs">Déconnexion</span>
              </Button>
            </div>
          )}
        </div>
      </header>

      {/* Mobile navigation drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* Drawer */}
          <div className="fixed left-0 right-0 top-14 sm:top-16 bottom-0 bg-background border-b overflow-y-auto">
            <div className="p-4 space-y-4">
              {/* Dashboard */}
              <Link
                to="/"
                onClick={() => setMobileMenuOpen(false)}
              >
                <Button
                  variant={location.pathname === '/' ? "default" : "outline"}
                  size="sm"
                  className="w-full gap-2 h-12"
                >
                  <LayoutDashboard className="h-4 w-4" />
                  <span>Dashboard</span>
                </Button>
              </Link>

              {/* Categories */}
              {navCategories.map((category) => {
                const CategoryIcon = category.icon;
                return (
                  <div key={category.label} className="space-y-2">
                    <div className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-muted-foreground">
                      <CategoryIcon className="h-4 w-4" />
                      <span>{category.label}</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {category.items.map((item) => {
                        const ItemIcon = item.icon;
                        const isActive = location.pathname === item.path;
                        return (
                          <Link
                            key={item.path}
                            to={item.path}
                            onClick={() => setMobileMenuOpen(false)}
                          >
                            <Button
                              variant={isActive ? "default" : "ghost"}
                              size="sm"
                              className="w-full gap-2 h-10 justify-start"
                            >
                              <ItemIcon className="h-4 w-4" />
                              <span>{item.label}</span>
                            </Button>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
