# ✨ SIRAJE STORE — Système E-Commerce & Gestion

Livres scolaires · Photocopie · Recharges IAM / Inwi / Orange

---

## 🚀 Lancement en 3 commandes

```bash
cd siraje-store
npm install        # une seule fois
node server.js     # démarrer
```

**Site client →** http://localhost:3000  
**Admin →**       http://localhost:3000/admin

---

## 🌐 Site Client (E-Commerce)

| Section | Fonctionnalité |
|---------|---------------|
| **Hero** | Présentation du store avec stats dynamiques |
| **Catalogue** | Grid de livres scolaires, recherche, filtres niveau |
| **Panier** | Sidebar avec ajout/suppression, persistance localStorage |
| **Commande** | Formulaire client → numéro de commande |
| **Recharges** | IAM / Inwi / Orange — sélection opérateur + montant |
| **Photocopie** | Calculateur de coût + formulaire de demande |
| **Suivi** | Recherche commande par numéro |

---

## ⚙️ Admin Panel

| Section | Fonctionnalité |
|---------|---------------|
| **Dashboard** | CA jour/mois, graphiques, alertes stock, top produits |
| **Commandes** | Liste complète, détails, changement de statut |
| **Recharges** | Demandes en attente → traiter ou annuler |
| **Photocopies** | Demandes en attente → traiter |
| **Caisse Recharge** | Vente directe en magasin |
| **Caisse Photo** | Calcul et vente directe |
| **Stock livres** | CRUD complet, ajustement stock, gestion visibilité |
| **Tarifs photo** | Modification des prix en temps réel |
| **Clients** | Base clients avec historique |
| **Historique** | Journal de caisse avec filtres par date |

---

## 🔄 Flux de travail

1. Client commande des livres en ligne → **Commandes** dans l'admin
2. Client demande une recharge → **Recharges** dans l'admin  
3. Client demande une photocopie → **Photocopies** dans l'admin
4. Vente directe en magasin → **Caisse** dans l'admin

---

## 📦 Prérequis

- Node.js v18+ : https://nodejs.org
- Aucune autre dépendance système
