require('dotenv').config();
async function main() {
  const { default: PocketBase } = await import('pocketbase');
  const pb = new PocketBase(process.env.POCKETBASE_URL || 'http://127.0.0.1:8090');
  await pb.collection('_superusers').authWithPassword(process.env.PB_ADMIN_EMAIL, process.env.PB_ADMIN_PASSWORD);
  const collection = await pb.collections.getOne('teams');
  if (!collection.fields.find(f => f.name === 'viceLeaderId')) {
    collection.fields.push({ name: 'viceLeaderId', type: 'text' });
    await pb.collections.update(collection.id, collection);
    console.log('Added viceLeaderId to teams');
  } else {
    console.log('viceLeaderId already exists');
  }
}
main().catch(console.error);
