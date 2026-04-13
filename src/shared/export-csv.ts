// CSV Export
// Usage: npx tsx src/shared/export-csv.ts [output-path]

import { initDB, exportCSV, closeDB } from './db.js';

async function main(): Promise<void> {
  const outputPath = process.argv[2] || 'results/results.csv';

  console.log('[Export] Connecting to PostgreSQL...');
  await initDB();

  console.log(`[Export] Exporting to ${outputPath}...`);
  await exportCSV(outputPath);

  await closeDB();
  console.log('[Export] Done.');
}

main().catch((err) => {
  console.error('Export error:', err);
  closeDB().catch(() => {});
  process.exit(1);
});
