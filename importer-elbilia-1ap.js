/**
 * IMPORT : Liste de fournitures + manuels — ELBILIA Safi, 1ère Année Primaire (2026-2027)
 *
 * Ajoute ~45 nouveaux produits (fournitures + livres) directement dans MongoDB Atlas,
 * en respectant exactement le même schéma que les produits déjà en stock.
 *
 * Tous les articles sont ajoutés avec :
 *   - prix = 0, stock = 0, visible = false (NON publiés)
 *   → à toi de renseigner prix/stock puis de les rendre visibles depuis l'admin
 *     (onglet Fournitures / Stock Livres), un par un ou en lot, avant publication.
 *
 * Ne touche à AUCUN produit existant — seulement des ajouts.
 * Si un article du même nom/école/niveau existe déjà, il est ignoré (pas de doublon).
 *
 * Utilisation (comme migrate-to-mongo.js) :
 *   MONGODB_URI="mongodb+srv://...(ta chaîne habituelle).../siraje_store?..." node importer-elbilia-1ap.js
 */
const { MongoClient } = require('mongodb');
const { randomUUID } = require('crypto');

const MONGODB_URI = process.env.MONGODB_URI;
const ECOLE = 'Elbilia Safi';
const NIVEAU = '1ère Année Primaire';
const ANNEE = '2026-2027';

function fourniture(nom, description, image_emoji) {
  return {
    id: randomUUID(), categorie: 'fourniture', nom, matiere: null, niveau: NIVEAU, ecole: ECOLE,
    editeur: null, description: description ? `${description} (${ANNEE})` : `(${ANNEE})`,
    prix: 0, prix_achat: 0, stock: 0, seuil_alerte: 3, image_emoji: image_emoji || '🎒',
    visible: false, featured: false, created_at: new Date().toISOString()
  };
}
function livre(nom, matiere, isbn, image_emoji) {
  return {
    id: randomUUID(), categorie: 'livre', nom, matiere, niveau: NIVEAU, ecole: ECOLE,
    editeur: null, description: isbn ? `ISBN : ${isbn} (${ANNEE})` : `(${ANNEE})`,
    prix: 0, prix_achat: 0, stock: 0, seuil_alerte: 3, image_emoji: image_emoji || '📗',
    visible: false, featured: false, created_at: new Date().toISOString()
  };
}

const nouveauxProduits = [
  // ── FRANÇAIS ──────────────────────────────────────────────
  fourniture('Cahier de poésie / TP petit format 50 pages', 'Couverture rose', '📕'),
  fourniture('Cahier de devoirs 100 pages', 'Avec protège blanc', '📓'),
  fourniture('Cahier du jour 100 pages', 'Avec protège bleu', '📘'),
  fourniture('Cahier de liaison 100 pages', 'Avec protège transparent', '📔'),
  fourniture('Cahier de texte', 'Avec protège rouge', '📕'),
  fourniture('Cahier de soutien 100 pages', 'Avec protège orange', '📙'),
  fourniture('Porte folio (100 vues)', 'Français', '📁'),
  fourniture('Ardoise + feutre + chiffon', null, '🖊️'),
  fourniture('Rame de papier', null, '📄'),
  // ── MATHEMATIQUES ─────────────────────────────────────────
  fourniture('Cahier 50 pages', 'Avec protège vert — Mathématiques', '📗'),
  // ── ARABE ─────────────────────────────────────────────────
  fourniture('Cahier 100 pages — القسم', 'Avec protège rouge — Arabe', '📕'),
  fourniture('Cahier 50 pages — التربية الإسلامية', 'Avec protège jaune — Arabe', '📒'),
  fourniture('Cahier 50 pages — الأنشطة المنزلية', 'Avec protège bleu — Arabe', '📘'),
  fourniture('Cahier 50 pages — الدعم', 'Avec protège rose — Arabe', '📔'),
  fourniture('Paquet de feuilles doubles petit format', 'Grands carreaux — Arabe', '📄'),
  // ── EVEIL SCIENTIFIQUE ────────────────────────────────────
  fourniture('Cahier de TP petit format 100 pages', 'Avec protège noir — Éveil scientifique', '📓'),
  // ── INFORMATIQUE ──────────────────────────────────────────
  fourniture('Portfolio 100 vues', 'Informatique', '📁'),
  // ── ARTS PLASTIQUES ───────────────────────────────────────
  fourniture('Papier canson à dessin blanc', '24cm x 32cm', '🎨'),
  fourniture('Papier canson couleur', '24cm x 32cm', '🎨'),
  fourniture('Papier canson format raisin', '50cm x 65cm — couleur verte', '🎨'),
  fourniture('Peinture gouache liquide 500ml', 'Couleur violet — de préférence marque Redimi Tempera Paint', '🎨'),
  fourniture('Pinceaux (x2)', 'Taille 6 – 12', '🖌️'),
  fourniture('Boîte de 24 feutres', 'Gros format', '🖍️'),
  fourniture('Chiffon et éponge', null, '🧽'),
  fourniture('Papier crépon', "N'importe quelle couleur sauf blanc", '🎨'),
  // ── TROUSSE COMPLETE ──────────────────────────────────────
  fourniture('Stylos bleu, vert et noir', 'Lot de 3', '✒️'),
  fourniture('Gomme blanche', null, '🧹'),
  fourniture('Règle', null, '📏'),
  fourniture('Boîte de 24 crayons de couleur', 'Marque Faber Castell', '🖍️'),
  fourniture('Crayons à papier (x2)', null, '✏️'),
  fourniture('Colle UHU Stick', 'Grand format', '🧴'),
  fourniture('Taille-crayon à réservoir', null, '✏️'),
  // ── MUSIQUE ───────────────────────────────────────────────
  fourniture('Flûte à bec', 'Musique', '🎵'),
  fourniture('Cahier de musique', 'Soulignement spécial musique', '🎵'),

  // ══ MANUELS (livres) ═══════════════════════════════════════
  livre('Manuel de l\'élève « Taoki et Compagnie »', 'Français', '978-2-01-725851-3'),
  livre('Cahier d\'exercices 1 « Taoki et Compagnie »', 'Français', '978-2-01-725852-0'),
  livre('Cahier d\'exercices 2 « Taoki et Compagnie »', 'Français', '978-2-01-725853-7'),
  livre('Cahier d\'écriture « Taoki et Compagnie »', 'Français', '978-2-01-725854-4'),
  livre('المفيد في اللغة العربية (طبعة شتنبر 2019)', 'Arabe', null),
  livre('مرشدي في التربية الإسلامية', 'Arabe', null),
  livre('« Vivre les maths » — pack élève Fichier 1 et 2 (2025)', 'Mathématiques', '978-209-505328-4'),
  livre('La cité des sciences — SIED Édition 2025', 'Éveil scientifique', '978-9920-9385-4-9'),
  livre('Skill Up Robotech — Édition 2025', 'Informatique', '978-9920-8628-8-2'),
  livre('Brighter Ideas — Class Book', 'Anglais', '978-0-19-409047-6'),
  livre('Brighter Ideas — Activity Book', 'Anglais', '978-0-19-409034-6'),
];

async function main() {
  if (!MONGODB_URI) {
    console.error('❌ Variable MONGODB_URI manquante. Exemple :');
    console.error('   MONGODB_URI="mongodb+srv://...ta chaîne habituelle.../siraje_store?..." node importer-elbilia-1ap.js');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const collection = client.db().collection('store');

  const doc = await collection.findOne({ _id: 'main' });
  if (!doc) {
    console.error('❌ Document principal introuvable sur Atlas.');
    await client.close();
    process.exit(1);
  }

  const existants = new Set(doc.produits.map(p => `${p.nom}|${p.ecole}|${p.niveau}`.toLowerCase()));
  const aAjouter = nouveauxProduits.filter(p => !existants.has(`${p.nom}|${p.ecole}|${p.niveau}`.toLowerCase()));
  const ignores = nouveauxProduits.length - aAjouter.length;

  if (aAjouter.length === 0) {
    console.log('ℹ️  Tous ces articles existent déjà — rien à ajouter.');
    await client.close();
    return;
  }

  await collection.updateOne({ _id: 'main' }, { $push: { produits: { $each: aAjouter } } });

  console.log(`✅ ${aAjouter.length} nouveaux articles ajoutés (${aAjouter.filter(p=>p.categorie==='fourniture').length} fournitures, ${aAjouter.filter(p=>p.categorie==='livre').length} manuels).`);
  if (ignores > 0) console.log(`ℹ️  ${ignores} article(s) déjà existant(s) ignoré(s) (pas de doublon créé).`);
  console.log('\n⚠️  Ils sont ajoutés NON VISIBLES (brouillon), prix/stock à 0.');
  console.log('   Va dans /admin → Fournitures / Stock pour renseigner les prix, le stock,');
  console.log('   puis les rendre visibles avant qu\'ils apparaissent sur le site public.');

  await client.close();
}

main().catch(err => {
  console.error('❌ Erreur import :', err.message);
  process.exit(1);
});
