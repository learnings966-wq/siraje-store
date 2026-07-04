/**
 * MIGRATION UNIQUE : siraje_data.json (local) → MongoDB Atlas
 *
 * À lancer UNE SEULE FOIS, depuis ton PC, avant le premier déploiement en ligne,
 * pour ne pas perdre tes 10 livres + 38 fournitures déjà en stock.
 *
 * Utilisation :
 *   1. Récupère ton URI Atlas (voir GUIDE-DEPLOIEMENT.md, étape MongoDB)
 *   2. MONGODB_URI="mongodb+srv://..." node migrate-to-mongo.js
 */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const DB_FILE = path.join(__dirname, 'siraje_data.json');

async function main() {
  if (!MONGODB_URI) {
    console.error('❌ Variable MONGODB_URI manquante. Exemple :');
    console.error('   MONGODB_URI="mongodb+srv://user:pass@cluster.mongodb.net/siraje_store" node migrate-to-mongo.js');
    process.exit(1);
  }
  if (!fs.existsSync(DB_FILE)) {
    console.error(`❌ Fichier introuvable : ${DB_FILE}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  console.log(`📦 Lu localement : ${data.produits?.length || 0} produits, ${data.commandes?.length || 0} commandes`);

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db();
  const collection = db.collection('store');

  const existing = await collection.findOne({ _id: 'main' });
  if (existing) {
    console.log('⚠️  Un document "main" existe déjà sur Atlas.');
    console.log('    Pour éviter d\'écraser des données déjà en ligne, la migration est annulée.');
    console.log('    Si tu veux vraiment écraser, supprime le document sur Atlas puis relance ce script.');
    await client.close();
    process.exit(1);
  }

  await collection.insertOne({ _id: 'main', ...data });
  console.log('✅ Migration terminée : tes données sont maintenant sur MongoDB Atlas.');
  await client.close();
}

main().catch(err => {
  console.error('❌ Erreur migration :', err.message);
  process.exit(1);
});
