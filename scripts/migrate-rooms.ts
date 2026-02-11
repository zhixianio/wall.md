/**
 * Migration script: Move hardcoded ROOMS to KV
 *
 * This script generates the JSON data needed to migrate rooms to KV storage.
 * It does NOT automatically write to KV - you must run the wrangler command manually.
 *
 * Usage:
 *   1. Run this script to generate the JSON:
 *      npx tsx scripts/migrate-rooms.ts
 *
 *   2. Copy the output JSON
 *
 *   3. Write to KV using wrangler:
 *      wrangler kv key put --namespace-id=<your-kv-id> "rooms:list" '<json-from-step-2>'
 *
 *   Or for production:
 *      wrangler kv key put --namespace-id=<your-kv-id> --env production "rooms:list" '<json-from-step-2>'
 */

import { ROOMS } from '../src/config';

function main() {
	console.log('📦 Migrating rooms to KV format...\n');

	const json = JSON.stringify(ROOMS, null, 2);

	console.log('✅ Generated JSON for KV storage:');
	console.log('─'.repeat(60));
	console.log(json);
	console.log('─'.repeat(60));
	console.log('\n📝 Next steps:');
	console.log('1. Copy the JSON above');
	console.log('2. Run the following command (replace <your-kv-id> with your actual KV namespace ID):');
	console.log('\n   For development:');
	console.log('   wrangler kv key put --namespace-id=<your-kv-id> "rooms:list" \'<paste-json-here>\'');
	console.log('\n   For production:');
	console.log('   wrangler kv key put --namespace-id=<your-kv-id> --env production "rooms:list" \'<paste-json-here>\'');
	console.log('\n3. Verify the data was written:');
	console.log('   wrangler kv key get --namespace-id=<your-kv-id> "rooms:list"');
	console.log('\n💡 Tip: You can find your KV namespace ID in wrangler.toml or by running:');
	console.log('   wrangler kv namespace list');
}

main();
