-- A legacy reporting deployment can have materialized views bound to orders.status.
-- Restore their definitions, indexes and access in the same transaction, without CASCADE.
DO $$
DECLARE
  saved_views jsonb;
  saved_view jsonb;
  view_name text;
  view_index text;
  view_grant jsonb;
BEGIN
  BEGIN
    ALTER TABLE public.orders ALTER COLUMN status SET DATA TYPE varchar(40);
  EXCEPTION WHEN feature_not_supported THEN
    SELECT jsonb_agg(jsonb_build_object(
      'name', c.relname,
      'definition', pg_get_viewdef(c.oid),
      'owner', pg_get_userbyid(c.relowner),
      'populated', c.relispopulated,
      'indexes', COALESCE((
        SELECT jsonb_agg(pg_get_indexdef(i.indexrelid))
        FROM pg_index i WHERE i.indrelid = c.oid
      ), '[]'::jsonb),
      'grants', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                         ELSE quote_ident(pg_get_userbyid(a.grantee)) END,
          'privilege', a.privilege_type,
          'grantable', a.is_grantable
        ))
        FROM aclexplode(c.relacl) a WHERE a.grantee <> c.relowner
      ), '[]'::jsonb)
    ))
    INTO saved_views
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'm'
      AND n.nspname = 'public'
      AND c.relname IN ('mv_event_sales_summary', 'mv_event_ticket_sales',
                        'mv_event_report_daily', 'mv_event_report_facts');

    IF saved_views IS NULL THEN RAISE; END IF;

    SELECT string_agg(format('public.%I', item->>'name'), ', ')
    INTO view_name
    FROM jsonb_array_elements(saved_views) AS item;
    EXECUTE 'DROP MATERIALIZED VIEW ' || view_name;
    ALTER TABLE public.orders ALTER COLUMN status SET DATA TYPE varchar(40);

    FOR saved_view IN SELECT * FROM jsonb_array_elements(saved_views) LOOP
      view_name := format('public.%I', saved_view->>'name');
      EXECUTE format('CREATE MATERIALIZED VIEW %s AS %s%s', view_name,
        rtrim(saved_view->>'definition', E';\n \t'),
        CASE WHEN (saved_view->>'populated')::boolean THEN '' ELSE ' WITH NO DATA' END);
      FOR view_index IN SELECT jsonb_array_elements_text(saved_view->'indexes') LOOP
        EXECUTE view_index;
      END LOOP;
      -- Remove grants from current default privileges before restoring legacy access.
      FOR view_grant IN
        SELECT jsonb_build_object('grantee',
          CASE WHEN a.grantee = 0 THEN 'PUBLIC'
               ELSE quote_ident(pg_get_userbyid(a.grantee)) END)
        FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
        WHERE c.oid = view_name::regclass AND a.grantee <> c.relowner
      LOOP
        EXECUTE format('REVOKE ALL ON TABLE %s FROM %s', view_name, view_grant->>'grantee');
      END LOOP;
      FOR view_grant IN SELECT * FROM jsonb_array_elements(saved_view->'grants') LOOP
        EXECUTE format('GRANT %s ON TABLE %s TO %s%s',
          view_grant->>'privilege', view_name, view_grant->>'grantee',
          CASE WHEN (view_grant->>'grantable')::boolean THEN ' WITH GRANT OPTION' ELSE '' END);
      END LOOP;
      EXECUTE format('ALTER MATERIALIZED VIEW %s OWNER TO %I', view_name, saved_view->>'owner');
    END LOOP;
  END;
END $$;
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'PENDING';
