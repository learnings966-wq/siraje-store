/**
 * SIRAJE STORE — Backend
 * Stockage 100% JSON (aucune compilation requise)
 * Livres scolaires · Photocopie · Recharges IAM / Inwi / Orange
 */

const express    = require('express');
const cors       = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const path  = require('path');
const fs    = require('fs');
const multer  = require('multer');
const pdfParse = require('pdf-parse');
const { extractImages, getDocumentProxy } = require('unpdf');
const { PNG } = require('pngjs');
const { createWorker } = require('tesseract.js');
const { MongoClient } = require('mongodb');

const app  = express();
const PORT = process.env.PORT || 3002;

// ═══════════════════════════════════════════════════════════════════════
//  CONNEXION MONGODB ATLAS (remplace l'ancien fichier siraje_data.json)
//  Toute la base reste stockée comme UN SEUL document (même structure que
//  l'ancien JSON) dans la collection "store", document _id: "main".
//  → aucune autre partie du code (produits, commandes, etc.) n'est modifiée.
// ═══════════════════════════════════════════════════════════════════════
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/siraje_store';
const mongoClient = new MongoClient(MONGODB_URI);
let storeCollection = null;

async function connectMongo() {
  await mongoClient.connect();
  const db = mongoClient.db(); // nom de la base pris dans l'URI
  storeCollection = db.collection('store');
  console.log('✅ Connecté à MongoDB Atlas');
}

// Upload PDF en mémoire (pas d'écriture sur disque) — 8 Mo max, PDF uniquement
const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') return cb(new Error('Seuls les fichiers PDF sont acceptés'));
    cb(null, true);
  }
});

// Upload fichiers à imprimer — écrit sur disque (temporaire, tant que le service
// n'est pas redémarré ; suffisant pour un aller-retour rapide client → magasin).
// PDF, images et documents Word/Excel courants, 15 Mo max.
const IMPRESSION_DIR = path.join(__dirname, 'uploads_impression');
if (!fs.existsSync(IMPRESSION_DIR)) fs.mkdirSync(IMPRESSION_DIR, { recursive: true });

const uploadImpression = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, IMPRESSION_DIR),
    filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname) || ''}`)
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const autorises = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    if (!autorises.includes(file.mimetype)) return cb(new Error('Format non supporté (PDF, image, Word ou Excel uniquement)'));
    cb(null, true);
  }
});

app.use(cors());
app.use(bodyParser.json());

// ═══════════════════════════════════════════════════════════════════════
//  PROTECTION DE L'ADMINISTRATION (Basic Auth HTTP)
//  Identifiants définis via variables d'environnement ADMIN_USER / ADMIN_PASSWORD
//  (à définir sur Render, ET dans un .env local si besoin en dev).
//  Doit être placé AVANT express.static, sinon public/admin/index.html
//  serait servi directement sans passer par cette vérification.
// ═══════════════════════════════════════════════════════════════════════
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;

function adminAuth(req, res, next) {
  if (!req.path.startsWith('/admin') && !req.path.startsWith('/api/admin')) return next();

  if (!ADMIN_PASSWORD) {
    // Sécurité : si la variable n'est pas configurée, on bloque plutôt que de laisser un accès ouvert par défaut.
    return res.status(503).send('Administration non configurée : variable ADMIN_PASSWORD manquante sur le serveur.');
  }

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    if (user === ADMIN_USER && pass === ADMIN_PASSWORD) return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="Siraje Store Admin"');
  return res.status(401).send('Authentification requise.');
}

app.use(adminAuth);
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads_impression', express.static(IMPRESSION_DIR));

// ═══════════════════════════════════════════════════════════════════════
//  BASE DE DONNÉES JSON
// ═══════════════════════════════════════════════════════════════════════

async function readDB() {
  const doc = await storeCollection.findOne({ _id: 'main' });
  return doc || null;
}

async function writeDB(data) {
  await storeCollection.replaceOne({ _id: 'main' }, { _id: 'main', ...data }, { upsert: true });
}

async function initDB() {
  const existing = await readDB();
  if (existing) return existing;

  const data = {
    produits: [],
    tarifs_photo: [],
    commandes: [],
    commande_items: [],
    clients: [],
    demandes_recharge: [],
    demandes_photo: [],
    ventes_caisse: [],
    signalements_fournitures: [],
    parametres: {
      adresse: '📍 Marrakech, Maroc',
      telephone: '📞 +212 6 XX XX XX XX',
      horaires: '🕐 Lun–Sam : 8h–20h',
      whatsapp: '',   // format international sans + ni espaces, ex: 212612345678
      email: ''
    }
  };

  // ── Livres scolaires ───────────────────────────────────────────────
  const livres = [
    { nom:'Mathématiques 3ème Collège',    matiere:'Mathématiques',  niveau:'3ème collège', editeur:'Dar Al Kitab', description:'Manuel complet avec exercices corrigés.',        prix:35, prix_achat:22, stock:14, seuil_alerte:3, image_emoji:'📐', visible:1, featured:1 },
    { nom:'Français Lecture CE2',          matiere:'Français',       niveau:'CE2 primaire', editeur:'Hachette Maroc',description:'Méthode de lecture syllabique.',                prix:28, prix_achat:18, stock:8,  seuil_alerte:3, image_emoji:'📖', visible:1, featured:1 },
    { nom:'Physique-Chimie 1ère Bac',      matiere:'Physique-Chimie',niveau:'1ère Bac',     editeur:'Al Manahil',  description:'Cours et exercices programme national.',         prix:42, prix_achat:26, stock:6,  seuil_alerte:2, image_emoji:'⚗️', visible:1, featured:1 },
    { nom:'Histoire-Géographie 6ème',      matiere:'Histoire-Géo',   niveau:'6ème collège', editeur:'Dar Al Kitab', description:'Cartes, chronologies et activités.',             prix:32, prix_achat:20, stock:10, seuil_alerte:3, image_emoji:'🗺️', visible:1, featured:0 },
    { nom:'SVT Tronc Commun',              matiere:'SVT',            niveau:'Tronc commun', editeur:'Al Manahil',  description:'Sciences de la vie et de la terre.',             prix:38, prix_achat:24, stock:7,  seuil_alerte:2, image_emoji:'🌿', visible:1, featured:0 },
    { nom:'Langue Arabe 4ème',             matiere:'Langue Arabe',   niveau:'4ème collège', editeur:'Dar Al Kitab', description:'Grammaire, conjugaison et expression écrite.',   prix:25, prix_achat:16, stock:15, seuil_alerte:5, image_emoji:'📝', visible:1, featured:1 },
    { nom:'Philosophie 2ème Bac',          matiere:'Philosophie',    niveau:'2ème Bac',     editeur:'Al Manahil',  description:'Textes et méthodologie de dissertation.',        prix:40, prix_achat:25, stock:5,  seuil_alerte:2, image_emoji:'🧠', visible:1, featured:0 },
    { nom:'Anglais Tronc Commun',          matiere:'Anglais',        niveau:'Tronc commun', editeur:'Hachette Maroc',description:'Activities, grammar and vocabulary.',           prix:35, prix_achat:22, stock:9,  seuil_alerte:3, image_emoji:'🇬🇧', visible:1, featured:0 },
    { nom:'Informatique 1ère Bac',         matiere:'Informatique',   niveau:'1ère Bac',     editeur:'Al Manahil',  description:'Algorithmique, réseaux et sécurité.',            prix:38, prix_achat:24, stock:4,  seuil_alerte:2, image_emoji:'💻', visible:1, featured:0 },
    { nom:'Mathématiques CE1 Primaire',    matiere:'Mathématiques',  niveau:'CE1 primaire', editeur:'Dar Al Kitab', description:'Calcul, géométrie et problèmes.',                prix:22, prix_achat:14, stock:12, seuil_alerte:4, image_emoji:'🔢', visible:1, featured:0 },
  ];
  livres.forEach(l => {
    data.produits.push({ id: uuidv4(), categorie: 'livre', ...l, created_at: new Date().toISOString() });
  });

  // ── Tarifs photocopie ──────────────────────────────────────────────
  const tarifs = [
    { libelle:'Photocopie N&B recto',       prix_unite:0.5, description:'Noir & blanc, 1 face',             actif:1 },
    { libelle:'Photocopie N&B recto-verso', prix_unite:0.8, description:'Noir & blanc, 2 faces',            actif:1 },
    { libelle:'Photocopie couleur',         prix_unite:2.0, description:'Couleur, 1 face',                  actif:1 },
    { libelle:'Scan / numérisation',        prix_unite:2.0, description:'Numérisation haute résolution',    actif:1 },
    { libelle:'Impression N&B',             prix_unite:1.0, description:'Impression depuis USB ou email',   actif:1 },
    { libelle:'Impression couleur A4',      prix_unite:3.0, description:'Impression couleur pleine page',   actif:1 },
    { libelle:'Reliure / plastification',   prix_unite:5.0, description:'Reliure spirale ou plastification',actif:1 },
  ];
  tarifs.forEach(t => {
    data.tarifs_photo.push({ id: uuidv4(), ...t });
  });

  await writeDB(data);
  return data;
}

let DB = null; // rempli par bootstrap() au démarrage, avant app.listen

// Sauvegarde (asynchrone, mais tous les appels existants `save();` restent
// valides — les erreurs éventuelles sont juste loguées, pas bloquantes)
function save() {
  return writeDB(DB).catch(err => console.error('❌ Erreur sauvegarde MongoDB :', err.message));
}

// ── HELPERS ────────────────────────────────────────────────────────────
function numCommande() {
  const d = new Date();
  const prefix = `SRJ-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const existing = DB.commandes.filter(c => c.numero.startsWith(prefix));
  const seq = existing.length + 1;
  return `${prefix}-${String(seq).padStart(4,'0')}`;
}

function today() { return new Date().toISOString().slice(0,10); }
function thisMonth() { return new Date().toISOString().slice(0,7); }
function isoNow() { return new Date().toISOString(); }

// ═══════════════════════════════════════════════════════════════════════
//  API PUBLIQUE — STOREFRONT
// ═══════════════════════════════════════════════════════════════════════

// Coordonnées du magasin (adresse, téléphone, horaires) — affichées dans le footer public
app.get('/api/parametres', (req, res) => {
  res.json(DB.parametres || {});
});

// Catalogue produits
app.get('/api/produits', (req, res) => {
  const { search, niveau, matiere, featured, categorie } = req.query;
  // Par défaut (compatibilité) : catalogue livres. On peut demander ?categorie=fourniture
  // pour la section fournitures, ou ?categorie=tous pour tout récupérer.
  const categorieVoulue = categorie || 'livre';
  let list = DB.produits.filter(p => p.visible);
  if (categorieVoulue !== 'tous') {
    list = list.filter(p => (p.categorie || 'livre') === categorieVoulue);
  }
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(p => p.nom.toLowerCase().includes(q) || (p.matiere||'').toLowerCase().includes(q) || (p.editeur||'').toLowerCase().includes(q));
  }
  if (niveau)   list = list.filter(p => p.niveau === niveau);
  if (matiere)  list = list.filter(p => p.matiere === matiere);
  if (featured) list = list.filter(p => p.featured);
  list.sort((a,b) => b.featured - a.featured || a.nom.localeCompare(b.nom));
  res.json(list);
});

app.get('/api/produits/:id', (req, res) => {
  const p = DB.produits.find(x => x.id === req.params.id && x.visible);
  if (!p) return res.status(404).json({ error: 'Non trouvé' });
  res.json(p);
});

// Tarifs photocopie (public)
app.get('/api/tarifs-photo', (req, res) => {
  res.json(DB.tarifs_photo.filter(t => t.actif).sort((a,b) => a.prix_unite - b.prix_unite));
});

// Passer une commande
app.post('/api/commandes', (req, res) => {
  const { client_nom, client_tel, client_adresse, mode_paiement, notes, items } = req.body;
  if (!client_nom || !client_tel) return res.status(400).json({ error: 'Nom et téléphone requis' });
  if (!items || !items.length)    return res.status(400).json({ error: 'Panier vide' });

  // Vérifier les stocks
  for (const item of items) {
    const p = DB.produits.find(x => x.id === item.produit_id);
    if (!p) return res.status(404).json({ error: `Produit "${item.nom}" introuvable` });
    if (p.stock < item.quantite) return res.status(400).json({ error: `Stock insuffisant pour "${p.nom}" (${p.stock} dispo)` });
  }

  // Trouver ou créer le client
  let client = DB.clients.find(c => c.telephone === client_tel);
  if (!client) {
    client = { id: uuidv4(), nom: client_nom, telephone: client_tel, adresse: client_adresse||null, email: null, created_at: isoNow() };
    DB.clients.push(client);
  }

  const id     = uuidv4();
  const numero = numCommande();
  const total  = items.reduce((s, i) => s + i.prix * i.quantite, 0);

  const commande = {
    id, numero,
    client_id: client.id,
    client_nom, client_tel,
    client_adresse: client_adresse||null,
    mode_paiement: mode_paiement||'especes',
    notes: notes||null,
    statut: 'nouvelle',
    total,
    created_at: isoNow()
  };
  DB.commandes.push(commande);

  items.forEach(item => {
    DB.commande_items.push({
      id: uuidv4(),
      commande_id: id,
      produit_id: item.produit_id,
      nom: item.nom,
      niveau: item.niveau||null,
      prix: item.prix,
      quantite: item.quantite,
      sous_total: item.prix * item.quantite
    });
    const p = DB.produits.find(x => x.id === item.produit_id);
    if (p) p.stock = Math.max(0, p.stock - item.quantite);
  });

  save();
  res.status(201).json({ id, numero, total, statut:'nouvelle', message:'Commande reçue avec succès !' });
});

// Suivi de commande
app.get('/api/commandes/suivi/:numero', (req, res) => {
  const c = DB.commandes.find(x => x.numero === req.params.numero);
  if (!c) return res.status(404).json({ error: 'Commande introuvable' });
  const its = DB.commande_items.filter(i => i.commande_id === c.id);
  res.json({ ...c, items: its });
});

// Demande de recharge
app.post('/api/services/recharge', (req, res) => {
  const { operateur, montant, client_nom, client_tel } = req.body;
  if (!operateur || !montant || !client_tel) return res.status(400).json({ error: 'Infos manquantes' });
  const id = uuidv4();
  DB.demandes_recharge.push({ id, operateur, montant: +montant, client_nom: client_nom||'Client', client_tel, statut:'en_attente', created_at: isoNow() });
  save();
  res.status(201).json({ id, message:`Demande de recharge ${operateur} ${montant} DH enregistrée. Présentez-vous en magasin.` });
});

// Demande de photocopie
app.post('/api/services/photo', (req, res) => {
  const { tarif_id, pages, client_nom, client_tel, notes } = req.body;
  if (!tarif_id || !pages) return res.status(400).json({ error: 'Tarif et pages requis' });
  const tarif = DB.tarifs_photo.find(t => t.id === tarif_id);
  if (!tarif) return res.status(404).json({ error: 'Tarif non trouvé' });
  const total = +(tarif.prix_unite * pages).toFixed(2);
  const id = uuidv4();
  DB.demandes_photo.push({ id, tarif_id, libelle: tarif.libelle, pages: +pages, total, client_nom: client_nom||'Client', client_tel: client_tel||null, notes: notes||null, statut:'en_attente', created_at: isoNow() });
  save();
  res.status(201).json({ id, total, message:`Demande enregistrée — total estimé : ${total} DH` });
});

// Upload d'un fichier à imprimer (client) — renvoie un lien de téléchargement
// direct, utilisable ensuite dans un message WhatsApp/email pré-rempli.
app.post('/api/photos/upload-fichier', uploadImpression.single('fichier'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
  res.status(201).json({
    url: `/uploads_impression/${req.file.filename}`,
    nom_original: req.file.originalname
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  API ADMIN
// ═══════════════════════════════════════════════════════════════════════

// Stats
app.get('/api/admin/stats', (req, res) => {
  const mois = thisMonth();
  const td   = today();

  const cmdsMois = DB.commandes.filter(c => c.created_at.startsWith(mois) && c.statut !== 'annulee');
  const caCommandes = cmdsMois.reduce((s,c) => s+c.total, 0);

  const rchMois = DB.demandes_recharge.filter(r => r.created_at.startsWith(mois) && r.statut === 'traitee');
  const caRecharges = rchMois.reduce((s,r) => s+r.montant, 0);

  const caisseMois = DB.ventes_caisse.filter(v => v.created_at.startsWith(mois));
  const caCaisse = caisseMois.reduce((s,v) => s+v.total, 0);

  const nbCommandes = DB.commandes.filter(c => c.statut === 'nouvelle').length;
  const nbRecharges = DB.demandes_recharge.filter(r => r.statut === 'en_attente').length;
  const nbPhotos    = DB.demandes_photo.filter(p => p.statut === 'en_attente').length;

  const stockAlerte = DB.produits.filter(p => p.visible && p.stock <= p.seuil_alerte).sort((a,b)=>a.stock-b.stock);

  // CA 7 jours
  const ca7j = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const jour = d.toISOString().slice(0,10);
    const ca = DB.commandes.filter(c => c.created_at.startsWith(jour) && c.statut !== 'annulee').reduce((s,c)=>s+c.total,0)
             + DB.ventes_caisse.filter(v => v.created_at.startsWith(jour)).reduce((s,v)=>s+v.total,0);
    ca7j.push({ jour, ca });
  }

  // Top produits du mois
  const ventesLivresMois = DB.commande_items.filter(i => {
    const cmd = DB.commandes.find(c => c.id === i.commande_id);
    return cmd && cmd.created_at.startsWith(mois) && cmd.statut !== 'annulee';
  });
  const topMap = {};
  ventesLivresMois.forEach(i => {
    if (!topMap[i.produit_id]) topMap[i.produit_id] = { nom: i.nom, vendu: 0, ca: 0 };
    topMap[i.produit_id].vendu += i.quantite;
    topMap[i.produit_id].ca   += i.sous_total;
  });
  const topProduits = Object.values(topMap).sort((a,b) => b.vendu - a.vendu).slice(0,5);

  // Par opérateur
  const opMap = {};
  rchMois.forEach(r => {
    if (!opMap[r.operateur]) opMap[r.operateur] = { operateur: r.operateur, nb: 0, total: 0 };
    opMap[r.operateur].nb++;
    opMap[r.operateur].total += r.montant;
  });
  const parOperateur = Object.values(opMap);

  res.json({ caCommandes, caRecharges, caCaisse, caMois: caCommandes+caRecharges+caCaisse,
    caJour: DB.commandes.filter(c=>c.created_at.startsWith(td)&&c.statut!=='annulee').reduce((s,c)=>s+c.total,0),
    nbCommandes, nbRecharges, nbPhotos, stockAlerte, ca7j, topProduits, parOperateur });
});

// ── Commandes ──────────────────────────────────────────────────────────
app.get('/api/admin/commandes', (req, res) => {
  const { statut } = req.query;
  let list = [...DB.commandes].sort((a,b) => b.created_at.localeCompare(a.created_at));
  if (statut) list = list.filter(c => c.statut === statut);
  res.json(list.map(c => ({ ...c, items: DB.commande_items.filter(i => i.commande_id === c.id) })));
});

app.put('/api/admin/commandes/:id', (req, res) => {
  const c = DB.commandes.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Non trouvé' });
  const { statut, notes } = req.body;
  // Si annulation → remettre le stock
  if (statut === 'annulee' && c.statut !== 'annulee') {
    DB.commande_items.filter(i => i.commande_id === c.id).forEach(i => {
      const p = DB.produits.find(x => x.id === i.produit_id);
      if (p) p.stock += i.quantite;
    });
  }
  if (statut) c.statut = statut;
  if (notes !== undefined) c.notes = notes;
  save();
  res.json(c);
});

// ── Produits ───────────────────────────────────────────────────────────
app.get('/api/admin/produits', (req, res) => {
  const { search, categorie, ecole } = req.query;
  let list = [...DB.produits];
  if (categorie) list = list.filter(p => (p.categorie || 'livre') === categorie);
  if (ecole) list = list.filter(p => p.ecole === ecole);
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(p => p.nom.toLowerCase().includes(q) || (p.matiere||'').toLowerCase().includes(q));
  }
  res.json(list.sort((a,b) => a.nom.localeCompare(b.nom)));
});

app.post('/api/admin/produits', (req, res) => {
  const { nom, matiere, niveau, editeur, description, prix, prix_achat, stock, seuil_alerte, image_emoji, featured, visible, categorie, ecole } = req.body;
  if (!nom) return res.status(400).json({ error: 'Nom requis' });
  const p = { id: uuidv4(), categorie: categorie||'livre', nom, matiere: matiere||null, niveau: niveau||null, ecole: ecole||null, editeur: editeur||null, description: description||null, prix: +(prix||0), prix_achat: +(prix_achat||0), stock: +(stock||0), seuil_alerte: +(seuil_alerte||3), image_emoji: image_emoji||'📗', visible: visible??1, featured: featured??0, created_at: isoNow() };
  DB.produits.push(p);
  save();
  res.status(201).json(p);
});

app.put('/api/admin/produits/:id', (req, res) => {
  const p = DB.produits.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Non trouvé' });
  Object.assign(p, req.body);
  save();
  res.json(p);
});

app.delete('/api/admin/produits/:id', (req, res) => {
  const p = DB.produits.find(x => x.id === req.params.id);
  if (p) p.visible = 0;
  save();
  res.json({ message: 'Produit archivé' });
});

app.patch('/api/admin/produits/:id/stock', (req, res) => {
  const p = DB.produits.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Non trouvé' });
  p.stock = Math.max(0, p.stock + (req.body.delta||0));
  save();
  res.json(p);
});

// ── Fournitures — Import depuis une liste PDF ────────────────────────────
// Analyse un PDF (liste de fournitures scolaires) et en extrait une liste
// d'articles proposés (nom + quantité). Rien n'est enregistré à cette étape :
// l'admin (ou le client) relit/corrige la liste côté interface avant validation.
function parseFournituresText(text) {
  const META_RE  = /^(niveau|classe|ann[ée]e|cycle|section|matière)\s*[:\-]?\s*/i;
  const TITLE_RE = /(\bfournitures?\b.*\bscolaires?\b)|(\bscolaires?\b.*\bfournitures?\b)|^liste\b/i;
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const items = [];
  for (const raw of lines) {
    let line = raw.replace(/^[•\-\*●▪◦·►]+\s*/, '').replace(/\s+/g, ' ').trim();
    if (!line || line.length < 2) continue;
    if (META_RE.test(line) || TITLE_RE.test(line)) continue;
    if (line.split(' ').length > 14) continue; // ligne trop longue = probablement pas un article
    const m = line.match(/^(\d{1,3})\s*(?:x|×)?\s+(.+)$/i);
    let quantite = 1, nom = line, quantite_detectee = false;
    if (m) { quantite = parseInt(m[1], 10); nom = m[2]; quantite_detectee = true; }
    nom = nom.trim().replace(/[.,;:]+$/, '');
    if (!nom || nom.length < 2) continue;
    nom = nom.charAt(0).toUpperCase() + nom.slice(1);
    items.push({ nom, quantite, quantite_detectee });
  }
  return items;
}

// Extrait le texte d'un PDF : d'abord en tant que texte natif (rapide, fiable),
// et si le PDF ne contient en réalité qu'une photo/scan (peu ou pas de texte),
// on bascule sur de l'OCR — 100% en JavaScript pur (unpdf + pngjs + tesseract.js),
// sans dépendre d'un logiciel externe (Poppler, ImageMagick…) à installer sur le poste.
const MIN_TEXT_LEN = 40;

function imageObjectToPngBuffer(img) {
  const png = new PNG({ width: img.width, height: img.height });
  const src = img.data;
  if (img.channels === 3) {
    for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
      png.data[j]   = src[i];
      png.data[j+1] = src[i+1];
      png.data[j+2] = src[i+2];
      png.data[j+3] = 255;
    }
  } else if (img.channels === 4) {
    png.data.set(src);
  } else { // 1 canal (niveaux de gris)
    for (let i = 0, j = 0; i < src.length; i++, j += 4) {
      png.data[j] = png.data[j+1] = png.data[j+2] = src[i];
      png.data[j+3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function avecDelaiMax(promise, ms, messageErreur) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(messageErreur)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function ocrPdfBuffer(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const nbPages = Math.min(pdf.numPages, 5); // on borne pour rester rapide
  // IMPORTANT : sans errorHandler, une erreur du worker Tesseract (ex : pas de connexion
  // internet pour télécharger les données de langue au premier lancement) fait planter
  // tout le processus Node — pas seulement la requête en cours. On l'intercepte proprement,
  // et on borne aussi le temps d'attente au cas où le chargement resterait bloqué.
  let workerError = null;
  const worker = await avecDelaiMax(
    createWorker('fra', 1, { errorHandler: (err) => { workerError = err; } }),
    45000,
    "Le moteur de lecture d'image (OCR) met trop de temps à démarrer — vérifiez la connexion internet du serveur (téléchargement des données de langue au premier lancement)."
  );
  let fullText = '';
  try {
    for (let p = 1; p <= nbPages; p++) {
      const images = await extractImages(pdf, p);
      for (const img of images) {
        if (img.width < 150 || img.height < 150) continue; // ignore petites icônes/logos
        const pngBuf = imageObjectToPngBuffer(img);
        const { data } = await avecDelaiMax(worker.recognize(pngBuf), 30000, "La lecture de l'image a pris trop de temps.");
        fullText += '\n' + data.text;
      }
    }
  } finally {
    try { await avecDelaiMax(worker.terminate(), 5000, 'timeout terminate'); } catch (_) { /* déjà arrêté */ }
  }
  if (workerError) {
    throw new Error("Le moteur de lecture d'image (OCR) n'a pas pu démarrer — vérifiez la connexion internet du serveur (téléchargement des données de langue au premier lancement).");
  }
  return { text: fullText, numpages: pdf.numPages };
}

async function extraireTexteDuPdf(buffer) {
  const data = await pdfParse(buffer);
  const texteBrut = data.text || '';
  const itemsTexte = texteBrut.trim().length >= MIN_TEXT_LEN ? parseFournituresText(texteBrut) : [];
  // Un vrai PDF-texte de liste donne plusieurs lignes exploitables ; sinon
  // (page vide, PDF = juste une photo/scan, texte parasite d'un "imprimer en PDF"…)
  // on bascule sur l'OCR de l'image intégrée.
  if (itemsTexte.length >= 3) {
    return { text: texteBrut, numpages: data.numpages, methode: 'texte' };
  }
  const ocr = await ocrPdfBuffer(buffer);
  if (!ocr.text || ocr.text.trim().length < 10) {
    throw new Error("Impossible de lire ce PDF (ni texte, ni image exploitable).");
  }
  return { text: ocr.text, numpages: ocr.numpages, methode: 'ocr' };
}

// ── Correspondance floue entre un nom extrait et les fournitures déjà en stock ──
function normaliserNom(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // retire les accents
    .replace(/[()]/g, ' ')       // garde les mots entre parenthèses (ex: "(tube)"), retire juste la ponctuation
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MOTS_VIDES = new Set([
  'de','du','des','le','la','les','un','une','et','en','a','au','aux','pour','avec','sur','sans',
  'tres','bonne','qualite','veuillez','preciser','nom','famille','svp','merci'
]);

function tokeniser(nomNormalise) {
  return nomNormalise.split(' ').filter(w => w.length > 1 && !MOTS_VIDES.has(w));
}

// Codes de format/taille trop génériques pour, seuls, justifier une correspondance
// (ex: "a4" apparaît dans une dizaine d'articles différents du catalogue)
const CODES_GENERIQUES = new Set(['a4','a3','a5','cm','mm','ml','kg','g']);

function scoreSimilarite(nomA, nomB) {
  const ta = new Set(tokeniser(normaliserNom(nomA)));
  const tb = new Set(tokeniser(normaliserNom(nomB)));
  if (!ta.size || !tb.size) return 0;
  const communs = [...ta].filter(t => tb.has(t));
  if (!communs.length) return 0;
  // Il faut au moins un mot "substantiel" en commun (pas seulement un format/code générique)
  const aUnMotSubstantiel = communs.some(t => /^[a-z]{4,}$/.test(t) && !CODES_GENERIQUES.has(t));
  if (!aUnMotSubstantiel) return 0;
  // Coefficient de chevauchement (Szymkiewicz–Simpson) : plus tolérant que Jaccard
  // quand l'un des deux noms est bien plus détaillé/verbeux que l'autre — ce qui est
  // typiquement le cas ici (description courte du client vs fiche catalogue détaillée).
  return communs.length / Math.min(ta.size, tb.size);
}

function trouverCorrespondanceFourniture(nomDemande, catalogue) {
  let meilleur = null, meilleurScore = 0;
  for (const p of catalogue) {
    const score = scoreSimilarite(nomDemande, p.nom);
    if (score > meilleurScore) { meilleurScore = score; meilleur = p; }
  }
  return meilleurScore >= 0.5 ? { produit: meilleur, score: meilleurScore } : null;
}

app.post('/api/admin/fournitures/extraire', uploadPdf.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier PDF reçu' });
  try {
    const { text, numpages, methode } = await extraireTexteDuPdf(req.file.buffer);
    const items = parseFournituresText(text);
    if (!items.length) return res.status(422).json({ error: "Impossible d'extraire des articles de ce PDF. Vérifiez qu'il contient bien une liste (une fourniture par ligne)." });
    res.json({ nb_pages: numpages, methode, items });
  } catch (e) {
    res.status(400).json({ error: 'PDF illisible : ' + e.message });
  }
});

// ── Fournitures — Analyse côté CLIENT : upload de la liste de l'école,       ──
// ── correspondance automatique avec le stock, pour pré-remplir le panier    ──
app.post('/api/fournitures/analyser', uploadPdf.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier PDF reçu' });
  try {
    const { text, numpages, methode } = await extraireTexteDuPdf(req.file.buffer);
    const items = parseFournituresText(text);
    if (!items.length) return res.status(422).json({ error: "Impossible de détecter des articles dans ce PDF. Essayez une photo plus nette ou un autre fichier." });

    const catalogue = DB.produits.filter(p => (p.categorie || 'livre') === 'fourniture');
    const disponibles = [];   // trouvés, publiés, prix défini → panier possible
    const enAttente   = [];   // trouvés dans le stock mais pas encore publiés/tarifés
    const nonReconnus = [];   // aucune correspondance dans le stock

    for (const it of items) {
      const match = trouverCorrespondanceFourniture(it.nom, catalogue);
      if (match && match.produit.visible && match.produit.prix > 0) {
        disponibles.push({
          produit_id: match.produit.id,
          nom: match.produit.nom,
          nom_demande: it.nom,
          prix: match.produit.prix,
          emoji: match.produit.image_emoji,
          stock: match.produit.stock,
          quantite: Math.min(it.quantite, Math.max(match.produit.stock, 0)) || 0,
          quantite_demandee: it.quantite,
          quantite_detectee: it.quantite_detectee
        });
      } else if (match) {
        enAttente.push({ nom_demande: it.nom, quantite: it.quantite, produit_id: match.produit.id });
      } else {
        nonReconnus.push({ nom_demande: it.nom, quantite: it.quantite });
      }
    }

    // On signale à l'équipe les articles à traiter (nouveaux ou à publier/tarifer)
    const aSignaler = [...enAttente, ...nonReconnus];
    for (const it of aSignaler) {
      const dejaSignale = DB.signalements_fournitures.find(s => s.statut === 'ouvert' && normaliserNom(s.nom_demande) === normaliserNom(it.nom_demande));
      if (dejaSignale) { dejaSignale.occurrences = (dejaSignale.occurrences||1) + 1; continue; }
      DB.signalements_fournitures.push({
        id: uuidv4(),
        nom_demande: it.nom_demande,
        quantite: it.quantite,
        produit_id: it.produit_id || null,
        type: it.produit_id ? 'a_publier' : 'inconnu',
        statut: 'ouvert',
        occurrences: 1,
        created_at: isoNow()
      });
    }
    if (aSignaler.length) save();

    res.json({ nb_pages: numpages, methode, disponibles, en_attente: enAttente, non_reconnus: nonReconnus });
  } catch (e) {
    res.status(400).json({ error: 'PDF illisible : ' + e.message });
  }
});

// Liste des signalements ouverts pour l'admin (articles à ajouter/publier/tarifer)
app.get('/api/admin/fournitures/signalements', (req, res) => {
  const list = DB.signalements_fournitures.filter(s => s.statut === 'ouvert')
    .sort((a,b) => b.occurrences - a.occurrences);
  res.json(list);
});

app.delete('/api/admin/fournitures/signalements/:id', (req, res) => {
  const s = DB.signalements_fournitures.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Non trouvé' });
  s.statut = 'traite';
  save();
  res.json({ message: 'Signalement traité' });
});


// ── Choix automatique d'une icône adaptée pour une fourniture ────────────
// On teste des mots-clés du plus spécifique au plus général, sur le nom normalisé.
const EMOJI_FOURNITURE_REGLES = [
  [/\bardoise\b/, '🪧'],
  [/\bblouse\b|\btablier\b/, '🥼'],
  [/\bcahiers?\b|\bcarnet\b/, '📓'],
  [/\bbloc\b|\blivret\b/, '📔'],
  [/\bporte\s?folio\b|\bclasseur\b/, '🗂️'],
  [/\bchemise\b|\bpochette\b/, '📁'],
  [/\bcarton\b/, '📦'],
  [/\bciseaux\b/, '✂️'],
  [/\bcolle\b/, '🧴'],
  [/\bcrayons?\s+de\s+couleur|\bfeutres?\b/, '🖍️'],
  [/\bcrayon\b|\btaille[\s-]?crayons?\b/, '✏️'],
  [/\bstylo\b/, '🖋️'],
  [/\bmarqueurs?\b/, '🖊️'],
  [/\bpapier\s+gomme\b/, '📄'],   // "papier gommé" avant la règle générique "gomme" (sinon mauvaise capture)
  [/\bgommettes?\b/, '⭐'],
  [/\bgomme\b/, '🧽'],
  [/\blingettes?\b/, '🧻'],
  [/\bmouchoirs?\b/, '🤧'],
  [/\bpapier\b|\bcanson\b|\bramette\b|\bfeuilles?\b/, '📄'],
  [/\bpeinture\b/, '🎨'],
  [/\bpinceaux?\b|\brouleau\s+.*peindre\b/, '🖌️'],
  [/\bpate\s+a\s+(modeler|fixe)\b/, '🟤'],
  [/\bregle\b|\bequerre\b|\brapporteur\b/, '📏'],
  [/\bcompas\b/, '📐'],
  [/\btrousse\b/, '👝'],
];

function choisirEmojiFourniture(nom) {
  const n = normaliserNom(nom);
  for (const [regex, emoji] of EMOJI_FOURNITURE_REGLES) {
    if (regex.test(n)) return emoji;
  }
  return '🎒'; // valeur par défaut générique pour une fourniture non reconnue
}

// Confirme l'import : crée un produit (catégorie "fourniture") par article validé.
// Utilisé dans la gestion de stock interne — pas encore affiché sur le site client.
app.post('/api/admin/fournitures/importer', (req, res) => {
  const { items, ecole, niveau } = req.body;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Aucun article à importer' });
  const crees = items.filter(it => it && it.nom && it.nom.trim()).map(it => {
    const p = {
      id: uuidv4(),
      categorie: 'fourniture',
      nom: it.nom.trim(),
      matiere: null,
      niveau: it.niveau || niveau || null,
      ecole: it.ecole || ecole || null,
      editeur: null,
      description: null,
      prix: +(it.prix || 0),
      prix_achat: +(it.prix_achat || 0),
      stock: +(it.quantite || 0),
      seuil_alerte: +(it.seuil_alerte || 5),
      image_emoji: it.image_emoji || choisirEmojiFourniture(it.nom),
      visible: 0,   // pas encore publié sur le site client
      featured: 0,
      created_at: isoNow()
    };
    DB.produits.push(p);
    return p;
  });
  save();
  res.status(201).json({ message: `${crees.length} fourniture(s) ajoutée(s) au stock`, items: crees });
});

// ── Recharges ──────────────────────────────────────────────────────────
app.get('/api/admin/recharges', (req, res) => {
  const { statut } = req.query;
  let list = [...DB.demandes_recharge].sort((a,b) => b.created_at.localeCompare(a.created_at));
  if (statut) list = list.filter(r => r.statut === statut);
  res.json(list.slice(0,200));
});

app.put('/api/admin/recharges/:id', (req, res) => {
  const r = DB.demandes_recharge.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Non trouvé' });
  r.statut = req.body.statut;
  if (req.body.statut === 'traitee') {
    DB.ventes_caisse.push({ id: uuidv4(), type:'recharge', description:`Recharge ${r.operateur} ${r.montant} DH — ${r.client_tel}`, quantite:1, prix_unitaire:r.montant, total:r.montant, operateur:r.operateur, reference_id:r.id, created_at: isoNow() });
  }
  save();
  res.json(r);
});

app.post('/api/admin/recharges/vendre', (req, res) => {
  const { operateur, montant, client_tel } = req.body;
  if (!operateur || !montant) return res.status(400).json({ error: 'Infos manquantes' });
  const id = uuidv4();
  DB.demandes_recharge.push({ id, operateur, montant:+montant, client_nom:'Vente directe', client_tel: client_tel||'—', statut:'traitee', created_at: isoNow() });
  DB.ventes_caisse.push({ id: uuidv4(), type:'recharge', description:`Recharge ${operateur} ${montant} DH`, quantite:1, prix_unitaire:+montant, total:+montant, operateur, reference_id:id, created_at: isoNow() });
  save();
  res.status(201).json({ message: 'Vente enregistrée' });
});

// ── Photocopies ────────────────────────────────────────────────────────
app.get('/api/admin/photos', (req, res) => {
  const { statut } = req.query;
  let list = [...DB.demandes_photo].sort((a,b) => b.created_at.localeCompare(a.created_at));
  if (statut) list = list.filter(p => p.statut === statut);
  res.json(list.slice(0,200));
});

app.put('/api/admin/photos/:id', (req, res) => {
  const ph = DB.demandes_photo.find(x => x.id === req.params.id);
  if (!ph) return res.status(404).json({ error: 'Non trouvé' });
  ph.statut = req.body.statut;
  if (req.body.statut === 'traitee') {
    DB.ventes_caisse.push({ id: uuidv4(), type:'photocopie', description:`${ph.libelle} — ${ph.pages} pages`, quantite:ph.pages, prix_unitaire: +(ph.total/ph.pages).toFixed(2), total:ph.total, operateur:null, reference_id:ph.id, created_at: isoNow() });
  }
  save();
  res.json(ph);
});

app.post('/api/admin/photos/vendre', (req, res) => {
  const { tarif_id, pages } = req.body;
  const tarif = DB.tarifs_photo.find(t => t.id === tarif_id);
  if (!tarif) return res.status(404).json({ error: 'Tarif non trouvé' });
  const total = +(tarif.prix_unite * pages).toFixed(2);
  const id = uuidv4();
  DB.demandes_photo.push({ id, tarif_id, libelle:tarif.libelle, pages:+pages, total, client_nom:'Vente directe', client_tel:'—', notes:null, statut:'traitee', created_at: isoNow() });
  DB.ventes_caisse.push({ id: uuidv4(), type:'photocopie', description:`${tarif.libelle} — ${pages} pages`, quantite:+pages, prix_unitaire:tarif.prix_unite, total, operateur:null, reference_id:id, created_at: isoNow() });
  save();
  res.status(201).json({ total, message: 'Vente enregistrée' });
});

// ── Paramètres du magasin (adresse, téléphone, horaires) ────────────────
app.get('/api/admin/parametres', (req, res) => {
  res.json(DB.parametres || {});
});

app.put('/api/admin/parametres', (req, res) => {
  const { adresse, telephone, horaires, whatsapp, email } = req.body;
  DB.parametres = {
    adresse: adresse ?? DB.parametres?.adresse ?? '',
    telephone: telephone ?? DB.parametres?.telephone ?? '',
    horaires: horaires ?? DB.parametres?.horaires ?? '',
    whatsapp: whatsapp ?? DB.parametres?.whatsapp ?? '',
    email: email ?? DB.parametres?.email ?? ''
  };
  save();
  res.json(DB.parametres);
});

// ── Tarifs ─────────────────────────────────────────────────────────────
app.get('/api/admin/tarifs', (req, res) => {
  res.json([...DB.tarifs_photo].sort((a,b) => a.prix_unite - b.prix_unite));
});

app.post('/api/admin/tarifs', (req, res) => {
  const { libelle, prix_unite, description } = req.body;
  const t = { id: uuidv4(), libelle, prix_unite: +prix_unite, description: description||null, actif: 1 };
  DB.tarifs_photo.push(t);
  save();
  res.status(201).json(t);
});

app.put('/api/admin/tarifs/:id', (req, res) => {
  const t = DB.tarifs_photo.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Non trouvé' });
  Object.assign(t, req.body);
  if (req.body.prix_unite !== undefined) t.prix_unite = +req.body.prix_unite;
  save();
  res.json(t);
});

// ── Clients ────────────────────────────────────────────────────────────
app.get('/api/admin/clients', (req, res) => {
  res.json(DB.clients.map(c => ({
    ...c,
    nb_commandes: DB.commandes.filter(x => x.client_id === c.id).length,
    total_achats: DB.commandes.filter(x => x.client_id === c.id && x.statut !== 'annulee').reduce((s,x)=>s+x.total,0)
  })).sort((a,b) => b.created_at.localeCompare(a.created_at)));
});

// ── Historique ─────────────────────────────────────────────────────────
app.get('/api/admin/historique', (req, res) => {
  const { debut, fin } = req.query;
  let list = [...DB.ventes_caisse].sort((a,b) => b.created_at.localeCompare(a.created_at));
  if (debut) list = list.filter(v => v.created_at.slice(0,10) >= debut);
  if (fin)   list = list.filter(v => v.created_at.slice(0,10) <= fin);
  res.json(list.slice(0,300));
});

// ── Gestion d'erreurs upload (multer) ────────────────────────────────────
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || (err && /PDF|non supporté/.test(err.message))) {
    return res.status(400).json({ error: err.message === 'File too large' ? 'Fichier trop volumineux (15 Mo max)' : err.message });
  }
  next(err);
});

// ── Fallback ───────────────────────────────────────────────────────────
app.get('/admin', (req,res) => res.sendFile(path.join(__dirname,'public','admin','index.html')));
app.get('/admin/*', (req,res) => res.sendFile(path.join(__dirname,'public','admin','index.html')));
app.get('*', (req,res) => res.sendFile(path.join(__dirname,'public','index.html')));

// ── Démarrage ──────────────────────────────────────────────────────────
async function bootstrap() {
  try {
    await connectMongo();
    DB = await initDB();
    if (!Array.isArray(DB.signalements_fournitures)) DB.signalements_fournitures = [];
    if (!DB.parametres) {
      DB.parametres = {
        adresse: '📍 Marrakech, Maroc',
        telephone: '📞 +212 6 XX XX XX XX',
        horaires: '🕐 Lun–Sam : 8h–20h',
        whatsapp: '',
        email: ''
      };
      save();
    }
    if (DB.parametres.whatsapp === undefined) { DB.parametres.whatsapp = ''; save(); }
    if (DB.parametres.email === undefined)    { DB.parametres.email = '';    save(); }

    app.listen(PORT, () => {
      console.log(`\n✨ SIRAJE STORE → http://localhost:${PORT}`);
      console.log(`   Admin       → http://localhost:${PORT}/admin`);
      console.log(`   Données     → MongoDB Atlas (${MONGODB_URI.replace(/\/\/.*@/, '//***@')})\n`);
    });
  } catch (err) {
    console.error('❌ Impossible de démarrer :', err.message);
    process.exit(1);
  }
}

bootstrap();
