// Applies db/migrations/*.sql in order, once each. Usage: DATABASE_URL=... tsx scripts/migrate.ts [--dev-stub]
import { promises as fs } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const sql = postgres(url, { max: 1, onnotice: () => {} });
const dir = path.join(process.cwd(), "db");

try {
  if (process.argv.includes("--dev-stub")) await sql.unsafe(await fs.readFile(path.join(dir, "dev/supabase-stub.sql"), "utf8"));
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
  const files = (await fs.readdir(path.join(dir, "migrations"))).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const body = await fs.readFile(path.join(dir, "migrations", f), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name) values (${f})`;
    });
    console.log(`applied ${f}`);
  }
  console.log("migrations up to date");
} finally {
  await sql.end();
}
