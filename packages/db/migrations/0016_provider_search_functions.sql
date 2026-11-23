-- Hand-written migration: search functions (Prompt 12, ADR-0019).

-- Whether a branch is open at an instant, in its local time. Mirrors openingStatus() in
-- @fleettrust/types (a test cross-checks them): a date's exception replaces that date's weekly
-- hours, and the previous day's overnight intervals still count after midnight. Branches that
-- never saved hours are not open (hours unknown).
CREATE FUNCTION branch_is_open(p_branch uuid, p_time_zone text, p_at timestamptz)
RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  WITH now_local AS (
    SELECT (p_at AT TIME ZONE p_time_zone) AS ts
  ), clock AS (
    SELECT ts::date AS today,
           (extract(hour FROM ts) * 60 + extract(minute FROM ts))::int AS minute
    FROM now_local
  ), days AS (
    SELECT today AS day, 0 AS shift FROM clock
    UNION ALL
    SELECT today - 1, 1440 FROM clock
  ), exception_intervals AS (
    SELECT d.shift,
           split_part(i->>'opens', ':', 1)::int * 60 + split_part(i->>'opens', ':', 2)::int AS opens,
           split_part(i->>'closes', ':', 1)::int * 60 + split_part(i->>'closes', ':', 2)::int AS closes
    FROM days d
    JOIN branch_hours_exceptions e ON e.branch_id = p_branch AND e.date = d.day
    CROSS JOIN LATERAL jsonb_array_elements(e.intervals) AS i
  ), intervals AS (
    SELECT shift, opens, CASE WHEN closes <= opens THEN closes + 1440 ELSE closes END AS closes
    FROM exception_intervals
    UNION ALL
    SELECT d.shift, h.opens_minute, h.closes_minute
    FROM days d
    JOIN branch_opening_hours h
      ON h.branch_id = p_branch AND h.weekday = extract(isodow FROM d.day)::int
    WHERE NOT EXISTS (
      SELECT 1 FROM branch_hours_exceptions e WHERE e.branch_id = p_branch AND e.date = d.day
    )
  )
  SELECT EXISTS (SELECT 1 FROM branches b WHERE b.id = p_branch AND b.hours_updated_at IS NOT NULL)
     AND EXISTS (
       SELECT 1 FROM intervals, clock
       WHERE clock.minute + intervals.shift >= intervals.opens
         AND clock.minute + intervals.shift < intervals.closes
     );
$$;
--> statement-breakpoint

-- Rebuilds an organization's search rows from its published snapshot (and removes them when
-- the profile isn't published). The only writer of provider_search_entries.
CREATE FUNCTION refresh_provider_search(p_organization uuid)
RETURNS void
LANGUAGE sql VOLATILE
AS $$
  DELETE FROM provider_search_entries WHERE organization_id = p_organization;
  INSERT INTO provider_search_entries (
    branch_id, organization_id, slug, trading_name, branch_name, locality, country_code,
    categories, vehicle_types, location, approx_location, service_radius_km, search_document,
    published_at
  )
  SELECT
    b.id,
    p.organization_id,
    p.slug,
    p.published_snapshot->>'tradingName',
    br->>'name',
    br->>'locality',
    br->>'countryCode',
    ARRAY(SELECT jsonb_array_elements_text(p.published_snapshot->'categories')),
    ARRAY(SELECT jsonb_array_elements_text(p.published_snapshot->'vehicleTypes')),
    ST_SetSRID(ST_MakePoint((br->'location'->>'lng')::float8, (br->'location'->>'lat')::float8), 4326)::geography,
    -- Same rounding as the public profile (Math.round to 2 decimals).
    ST_SetSRID(ST_MakePoint(
      floor((br->'location'->>'lng')::numeric * 100 + 0.5) / 100,
      floor((br->'location'->>'lat')::numeric * 100 + 0.5) / 100
    )::geometry, 4326)::geography,
    (br->>'serviceRadiusKm')::smallint,
    setweight(to_tsvector('simple', coalesce(p.published_snapshot->>'tradingName', '')), 'A')
      || setweight(to_tsvector('simple', replace(
           array_to_string(ARRAY(SELECT jsonb_array_elements_text(p.published_snapshot->'categories')), ' '),
           '_', ' ')), 'A')
      || setweight(to_tsvector('simple', coalesce((
           SELECT string_agg(o->>'name', ' ')
           FROM jsonb_array_elements(coalesce(p.published_snapshot->'offerings', '[]'::jsonb)) AS o
         ), '')), 'B')
      || setweight(to_tsvector('simple', concat_ws(' ', br->>'name', br->>'locality')), 'C')
      || setweight(to_tsvector('simple', coalesce(p.published_snapshot->>'description', '')), 'D'),
    p.published_at
  FROM provider_profiles p
  CROSS JOIN LATERAL jsonb_array_elements(p.published_snapshot->'branches') AS br
  JOIN branches b ON b.id = (br->>'id')::uuid AND b.organization_id = p.organization_id
  WHERE p.organization_id = p_organization
    AND p.status = 'published'
    AND p.published_snapshot IS NOT NULL
    AND p.published_at IS NOT NULL;
$$;
--> statement-breakpoint

-- Backfill: profiles published before this migration.
SELECT refresh_provider_search(organization_id) FROM provider_profiles WHERE status = 'published';
