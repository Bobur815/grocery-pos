import fs from 'fs';
import path from 'path';

/**
 * Every column in the SQLite schema must be reachable by a real database.
 *
 * The POS never runs `prisma migrate` — `sqlite-client.ts` owns the local schema by hand, so a
 * field added to `schema.sqlite.prisma` exists for the generated client but not for any actual
 * .db file until someone also writes the CREATE TABLE column or an ALTER migration. Prisma
 * SELECTs every scalar it knows about, so one forgotten column fails the whole INSERT with
 * P2022 — for `sales` that means no cashier can complete a sale, on every terminal at once, the
 * moment the build lands.
 *
 * That is exactly how `regos_payment_id` and `regos_payment_rrn` shipped in the UzQR commit:
 * declared in the schema, never added to the local database. It only stayed hidden because the
 * machine that wrote it had run `prisma db push` by hand.
 */

const ROOT = path.join(__dirname, '..', '..', '..');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'prisma', 'schema.sqlite.prisma'), 'utf8');
const CLIENT = fs.readFileSync(path.join(ROOT, 'src', 'main', 'database', 'sqlite-client.ts'), 'utf8');

const toSnakeCase = (field: string) => field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

interface Model {
  name: string;
  table: string;
  columns: string[];
}

/** Scalar columns per model, keyed by the table name the app actually talks to. */
function parseModels(schema: string): Model[] {
  const models: Model[] = [];

  for (const [, name, body] of schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)) {
    const table = body.match(/@@map\("(\w+)"\)/)?.[1];
    if (!table) continue;

    const columns: string[] = [];
    for (const line of body.split('\n')) {
      const declaration = line.match(/^ {2}(\w+)\s+(\w+)(\[\])?/);
      if (!declaration) continue;

      const [, field, type, isList] = declaration;
      // A list is the far side of a relation; a bare relation field is backed by its own
      // scalar (`categoryId`), which is declared separately and picked up on its own line.
      if (isList) continue;
      if (line.includes('@relation(') && !line.includes('fields:')) continue;
      if (/^[A-Z]/.test(type) && !['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Decimal', 'Json', 'Bytes', 'BigInt'].includes(type)) {
        continue;
      }

      columns.push(line.match(/@map\("(\w+)"\)/)?.[1] ?? toSnakeCase(field));
    }

    models.push({ name, table, columns });
  }

  return models;
}

/** Everything sqlite-client.ts can put on `table`: its CREATE TABLE body plus every ALTER. */
function columnsCreatableFor(table: string): string {
  const created = [...CLIENT.matchAll(
    new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\)\\s*\``, 'g'),
  )].map((m) => m[1]);

  const altered = [...CLIENT.matchAll(
    new RegExp(`ALTER TABLE ${table} ADD COLUMN (\\w+)`, 'g'),
  )].map((m) => m[1]);

  return [...created, ...altered].join('\n');
}

describe('SQLite schema is reachable from sqlite-client.ts', () => {
  const models = parseModels(SCHEMA);

  it('parses the schema at all (guards the regexes above)', () => {
    expect(models.length).toBeGreaterThan(10);
    expect(models.find((m) => m.table === 'sales')?.columns).toEqual(
      expect.arrayContaining(['receipt_number', 'final_amount', 'cashier_id']),
    );
  });

  it.each(parseModels(SCHEMA).map((m): [string, Model] => [m.table, m]))(
    '%s: every column is created or migrated',
    (table, model) => {
      const reachable = columnsCreatableFor(table);
      expect(reachable).not.toBe('');

      const missing = model.columns.filter(
        (column) => !new RegExp(`\\b${column}\\b`).test(reachable),
      );

      expect(missing).toEqual([]);
    },
  );
});
