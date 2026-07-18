/**
 * IMPORT GÉNÉRIQUE de liste scolaire (fournitures + manuels) vers MongoDB Atlas.
 *
 * Ce script est RÉUTILISABLE pour toute future liste — il ne contient AUCUNE
 * donnée codée en dur. Toutes les données viennent d'un fichier JSON séparé.
 *
 * Utilisation :
 *   MONGODB_URI="ta chaîne habituelle" node import-liste.js chemin/vers/liste.json
 *
 * Si aucun chemin n'est précisé, il cherche par défaut "liste-a-importer.json"
 * dans le même dossier que ce script.
 *
 * Format attendu du fichier JSON : voir liste-exemple.json fourni à côté.
 *
 * Comportement (identique à chaque fois) :
 *   - Ajoute les nouveaux articles en brouillon (prix=0, stock=0, non visibles)
 *   - Ignore automatiquement les doublons (même nom + école + niveau déjà en stock)
 *   - Ne modifie ni ne supprime jamais un article existant
 */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { randomUUID } = require('crypto');

const MONGODB_URI = process.env.MONGODB_URI;
const fichierJson = process.argv[2] || path.join(__dirname, 'liste-a-importer.json');

function construireProduit(item, ecole, niveau, anneeScolaire) {
  const suffixe = anneeScolaire ? ` (${anneeScolaire})` : '';
  if (item.type === 'livre') {
    return {
      id: randomUUID(), categorie: 'livre', nom: item.nom, matiere: item.matiere || null,
      niveau, ecole, editeur: item.editeur || null,
      description: (item.isbn ? `ISBN : ${item.isbn}` : '') + suffixe || null,
      prix: 0, prix_achat: 0, stock: 0, seuil_alerte: 3, image_emoji: item.icone || '📗',
      visible: false, featured: false, created_at: new Date().toISOString()
    };
  }
  return {
    id: randomUUID(), categorie: 'fourniture', nom: item.nom, matiere: item.matiere || null,
    niveau, ecole, editeur: null,
    description: ((item.description || '') + suffixe).trim() || null,
    prix: 0, prix_achat: 0, stock: 0, seuil_alerte: 3, image_emoji: item.icone || '🎒',
    visible: false, featured: false, created_at: new Date().toISOString()
  };
}

async function main() {
  if (!MONGODB_URI) {
    console.error('❌ Variable MONGODB_URI manquante. Exemple :');
    console.error('   MONGODB_URI="mongodb+srv://...ta chaîne habituelle..." node import-liste.js liste.json');
    process.exit(1);
  }
  if (!fs.existsSync(fichierJson)) {
    console.error(`❌ Fichier introuvable : ${fichierJson}`);
    console.error('   Précise le chemin : node import-liste.js chemin/vers/ta-liste.json');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(fichierJson, 'utf8'));
  if (!data.ecole || !data.niveau || !Array.isArray(data.articles)) {
    console.error('❌ Format invalide. Le fichier doit contenir : { "ecole", "niveau", "annee_scolaire", "articles": [...] }');
    process.exit(1);
  }

  const nouveauxProduits = data.articles.map(item => construireProduit(item, data.ecole, data.niveau, data.annee_scolaire));

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

  console.log(`✅ ${aAjouter.length} nouveaux articles ajoutés pour "${data.ecole} — ${data.niveau}"`);
  console.log(`   (${aAjouter.filter(p=>p.categorie==='fourniture').length} fournitures, ${aAjouter.filter(p=>p.categorie==='livre').length} manuels)`);
  if (ignores > 0) console.log(`ℹ️  ${ignores} article(s) déjà existant(s) ignoré(s) (pas de doublon créé).`);
  console.log('\n⚠️  Ajoutés NON VISIBLES (brouillon), prix/stock à 0.');
  console.log('   Va dans /admin → Fournitures / Stock pour renseigner prix/stock puis les rendre visibles.');

  await client.close();
}

main().catch(err => {
  console.error('❌ Erreur import :', err.message);
  process.exit(1);
});
