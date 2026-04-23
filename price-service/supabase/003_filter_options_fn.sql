CREATE OR REPLACE FUNCTION get_filter_options()
RETURNS json
LANGUAGE sql
STABLE
AS $$
  SELECT json_build_object(
    'suppliers', (
      SELECT COALESCE(json_agg(s ORDER BY s), '[]'::json)
      FROM (SELECT DISTINCT supplier_name AS s FROM wine_items WHERE supplier_name IS NOT NULL AND supplier_name != 'null') t
    ),
    'countries', (
      SELECT COALESCE(json_agg(c ORDER BY c), '[]'::json)
      FROM (SELECT DISTINCT country AS c FROM wine_items WHERE country IS NOT NULL) t
    ),
    'grapes', (
      SELECT COALESCE(json_agg(g ORDER BY g), '[]'::json)
      FROM (
        SELECT DISTINCT TRIM(unnested) AS g
        FROM wine_items, unnest(string_to_array(grape_variety, ',')) AS unnested
        WHERE grape_variety IS NOT NULL AND TRIM(unnested) != ''
      ) t
    )
  )
$$;
