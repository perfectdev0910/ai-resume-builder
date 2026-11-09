/**
 * Clears one account's application history.
 *
 * Why this exists: changing the email on the Profile page updates users.email but
 * keeps the same users.id, and every application hangs off that id. So a "new user"
 * created by editing the email inherits the old one's history, and the duplicate
 * check keeps blocking companies they never applied to. This wipes that history
 * without touching the profile, so the account can bid on every company again.
 *
 *   node src/jobs/reset-user-history.js someone@example.com            # report only
 *   node src/jobs/reset-user-history.js someone@example.com --confirm  # delete
 */
const isPostgres = !!process.env.DATABASE_URL;
const db = isPostgres
  ? require('../models/database.postgres')
  : require('../models/database');

const ph = (n) => (isPostgres ? `$${n}` : '?');

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes('--confirm');
  const email = String(args.find((a) => !a.startsWith('--')) || '').trim().toLowerCase();

  if (!email) {
    console.error('Usage: node src/jobs/reset-user-history.js <email> [--confirm]');
    process.exit(1);
  }

  if (db.initDatabase) await db.initDatabase();

  const user = await db.getOne(
    `SELECT id, email, full_name FROM users WHERE LOWER(email) = ${ph(1)}`,
    [email],
  );
  if (!user) {
    console.error(`No account found for ${email}`);
    process.exit(1);
  }

  const stats = await db.getOne(
    `SELECT COUNT(*) AS total,
            COUNT(DISTINCT company_name) AS companies,
            MIN(applied_at) AS first_at,
            MAX(applied_at) AS last_at
       FROM applications WHERE user_id = ${ph(1)}`,
    [user.id],
  );

  const total = Number(stats && stats.total) || 0;
  console.log(`Database : ${isPostgres ? 'PostgreSQL (DATABASE_URL)' : 'SQLite (local data/)'}`);
  console.log(`Account  : ${user.email} (users.id = ${user.id}, ${user.full_name || 'no name'})`);
  console.log(`History  : ${total} applications across ${Number(stats && stats.companies) || 0} companies`);
  if (total) console.log(`Range    : ${stats.first_at} -> ${stats.last_at}`);

  if (!total) {
    console.log('\nNothing to clear; this account already bids on every company.');
    process.exit(0);
  }

  if (!confirm) {
    console.log('\nReport only. Re-run with --confirm to delete these rows.');
    console.log('The profile, employment, education and skills are never touched.');
    process.exit(0);
  }

  const result = await db.runQuery(
    `DELETE FROM applications WHERE user_id = ${ph(1)}`,
    [user.id],
  );
  const removed = (result && (result.rowCount ?? result.changes)) ?? total;

  const left = await db.getOne(
    `SELECT COUNT(*) AS total FROM applications WHERE user_id = ${ph(1)}`,
    [user.id],
  );

  console.log(`\nDeleted ${removed} applications. Remaining for this account: ${Number(left && left.total) || 0}`);
  console.log(`${user.email} can now apply to every company again.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(`Reset failed: ${error.message}`);
  process.exit(1);
});
