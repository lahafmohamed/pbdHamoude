# 🖥️ Magasin Informatique - Gestion de Facturation & Stock

Logiciel de facturation et suivi de stock pour magasin d'informatique.

## 🏗️ Architecture

```
magasinProgramme/
├── backend/              # Node.js + Express + TypeScript + PostgreSQL
│   ├── src/
│   │   ├── controllers/  # Logique métier
│   │   ├── routes/       # Routes API
│   │   ├── models/       # Interfaces TypeScript
│   │   ├── db/           # Connection DB + Migrations SQL
│   │   ├── middleware/   # Auth, Validation, Security
│   │   ├── validation/   # Zod schemas
│   │   └── server.ts     # Point d'entrée
│   └── .env              # Configuration
│
└── frontend/             # React + TypeScript + Vite + Tailwind + daisyUI
    └── src/
        ├── pages/        # Dashboard, Inventaire, Clients, Factures, Login
        ├── components/   # Navbar, ProtectedRoute, GlobalSearch
        ├── services/     # API & Auth clients
        ├── lib/          # AuthContext
        └── types/        # Interfaces TypeScript
```

## 🔒 Phase 1 - Security & Foundation (COMPLETED)

### Security
- **JWT Authentication** - Auth avec rôles (admin, manager, caissier)
- **Zod Validation** - Validation de toutes les entrées API
- **Helmet** - Security headers HTTP
- **Rate Limiting** - Protection contre les abus (100 req/15min global, 10 req/15min auth)
- **CORS Restricted** - Limité au frontend origin uniquement

### Database Improvements
- **Soft Deletes** - Colonnes `deleted_at` sur toutes les tables principales
- **Sequences** - Numérotation factures/commandes via PostgreSQL sequences (évite les race conditions)
- **Stock Movement Logging** - Trigger activé pour tracer les mouvements de stock
- **Audit Log** - Table `audit_log` pour tracer les actions utilisateurs

### Frontend
- **Login Page** - Authentification avec validation Zod + react-hook-form
- **Protected Routes** - Toutes les routes nécessitent une authentification
- **Role-based Access** - Support pour restriction par rôle
- **User Display** - Navbar affiche l'utilisateur connecté avec bouton déconnexion

### Default Users

> ⚠️ **Default seed credentials have been removed from this document for security reasons.**
> Check the database seed file (`backend/src/db/seed.sql` or the migration that inserts default users) and **change all passwords immediately after first login** using the password-change endpoint.

## 🚀 Démarrage

### Prérequis
- Node.js >= 18
- PostgreSQL installé et démarré

### 1. Database Setup

```bash
cd backend
copy .env.example .env
# Modifier .env avec vos identifiants PostgreSQL

# Appliquer les migrations
node setup-db-phase1.mjs
```

### 2. Backend

```bash
cd backend
npm install
npm run dev
```

Le backend tourne sur **http://localhost:6000**

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Le frontend tourne sur **http://localhost:6001**

## 📋 Fonctionnalités

- **📊 Dashboard** - Vue d'ensemble avec statistiques rapides
- **📦 Inventaire** - Gestion des produits, stock, alertes
- **👥 Clients** - Répertoire clients avec historique d'achats
- **🧾 Factures** - Création de factures avec sortie de stock automatique
- **➕ Nouvelle Facture** - Écran unique, recherche produit inline, tout en un clic
- **🔐 Authentication** - Login avec rôles et permissions
- **🛡️ Security** - Rate limiting, validation, security headers

## 🔌 API Endpoints

### Auth
| Method | Endpoint              | Description              | Auth  |
|--------|----------------------|--------------------------|-------|
| POST   | /api/auth/login      | Connexion                | Public|
| POST   | /api/auth/register   | Créer un utilisateur     | Admin |
| GET    | /api/auth/me         | Infos utilisateur courant| All   |
| PUT    | /api/auth/change-password | Changer mot de passe | All   |
| GET    | /api/auth/users      | Liste utilisateurs       | Admin |
| PUT    | /api/auth/users/:id  | Modifier utilisateur     | Admin |

### Produits
| Method | Endpoint           | Description          | Auth |
|--------|-------------------|----------------------|------|
| GET    | /api/produits     | Liste tous les produits | All |
| GET    | /api/produits/:id | Un produit           | All  |
| POST   | /api/produits     | Créer un produit     | All  |
| PUT    | /api/produits/:id | Modifier un produit  | All  |
| DELETE | /api/produits/:id | Supprimer un produit | All  |
| PATCH  | /api/produits/:id/stock | Ajuster stock  | All  |

### Clients
| Method | Endpoint                  | Description           | Auth |
|--------|--------------------------|-----------------------|------|
| GET    | /api/clients             | Liste tous les clients | All  |
| GET    | /api/clients/:id         | Un client             | All  |
| GET    | /api/clients/:id/historique | Historique achats  | All  |
| POST   | /api/clients             | Créer un client       | All  |
| PUT    | /api/clients/:id         | Modifier un client    | All  |
| DELETE | /api/clients/:id         | Supprimer un client   | All  |

### Factures
| Method | Endpoint                   | Description                      | Auth |
|--------|---------------------------|----------------------------------|------|
| GET    | /api/factures             | Liste toutes les factures        | All  |
| GET    | /api/factures/stats       | Statistiques rapides             | All  |
| GET    | /api/factures/:id         | Une facture avec ses lignes      | All  |
| POST   | /api/factures             | Créer facture + sortie stock auto | All |
| PUT    | /api/factures/:id/statut  | Changer le statut                | All  |
| DELETE | /api/factures/:id         | Supprimer (option: restaurer stock) | All |

## 🎨 Stack

**Backend:** Node.js, Express, TypeScript, PostgreSQL, jsonwebtoken, bcrypt, zod, helmet, express-rate-limit
**Frontend:** React, TypeScript, Vite, TailwindCSS, daisyUI (thème "corporate"), react-hook-form, zod
