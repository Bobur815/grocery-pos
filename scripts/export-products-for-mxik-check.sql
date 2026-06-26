-- Export active products (+ their category's MXIK group) as a single JSON array, so the data can
-- be carried to a machine on a Uzbekistan IP and audited against tasnif.soliq.uz (geo-blocked from
-- the Germany VPS). `mxik` is included because it is the value the audit script checks.
--
-- Run on the VPS, writing the JSON to a file you then copy to the local PC:
--
--   # direct psql:
--   psql "$DATABASE_URL" -At -f scripts/export-products-for-mxik-check.sql > products.json
--
--   # dockerised postgres (replace <db-service>/<user> with yours, e.g. `db` / `posgro`):
--   docker compose exec -T <db-service> psql -U <user> -d posgro -At \
--     -f - < scripts/export-products-for-mxik-check.sql > products.json
--
-- -At = tuples-only + unaligned → the file is pure JSON with no headers/padding.
-- Change STORE_ID ('1234') or drop the `active` filter below if you need a different scope.
SELECT json_agg(t ORDER BY t.id)
FROM (
  SELECT p.id,
         p.barcode,
         p.name_uz            AS "nameUz",
         p.mxik,
         p.store_product_code AS "storeProductCode",
         c.name_ru            AS "categoryName",
         c.mxik_group_code    AS "categoryMxikGroupCode"
  FROM products p
  JOIN categories c ON c.id = p.category_id
  WHERE p.store_id = '1234'
    AND p.active = true
) t;
