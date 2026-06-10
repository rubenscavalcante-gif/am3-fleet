-- AM3 Fleet - schema minimo Postgres
-- Modelo atual em tabela unica com payload JSONB.

CREATE TABLE IF NOT EXISTS public.am3_fleet_records (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT am3_fleet_records_pk PRIMARY KEY (collection, id)
);

CREATE INDEX IF NOT EXISTS am3_fleet_records_collection_idx
  ON public.am3_fleet_records(collection);

-- Usuario somente leitura para integrações externas, exemplo:
-- CREATE ROLE am3_fleet_reader WITH LOGIN PASSWORD 'trocar_por_senha_forte';
-- GRANT USAGE ON SCHEMA public TO am3_fleet_reader;
-- GRANT SELECT ON public.am3_fleet_records TO am3_fleet_reader;
