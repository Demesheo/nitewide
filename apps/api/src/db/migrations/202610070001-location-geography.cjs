'use strict';
module.exports = {
  async up(q) {
    await q.sequelize.transaction(async transaction => {
      await q.sequelize.query(`
        ALTER TABLE locations
          ADD COLUMN county_fips varchar(5),
          ADD COLUMN geocode_status varchar(20) NOT NULL DEFAULT 'unverified',
          ADD COLUMN geocode_source varchar(40),
          ADD COLUMN geocode_address_hash varchar(64),
          ADD COLUMN geocode_benchmark varchar(80),
          ADD COLUMN geocode_vintage varchar(80),
          ADD COLUMN geocoded_at timestamptz,
          ADD COLUMN geocode_attempts integer NOT NULL DEFAULT 0,
          ADD COLUMN geocode_next_attempt_at timestamptz;
        CREATE FUNCTION location_address_hash(address1 text,address2 text,city text,region text,postal text,country text)
          RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
          SELECT encode(digest(concat_ws(E'\\n',
            btrim(regexp_replace(lower(coalesce(address1,'')), '[[:space:]]+', ' ', 'g')),
            btrim(regexp_replace(lower(coalesce(address2,'')), '[[:space:]]+', ' ', 'g')),
            btrim(regexp_replace(lower(coalesce(city,'')), '[[:space:]]+', ' ', 'g')),
            btrim(regexp_replace(lower(coalesce(region,'')), '[[:space:]]+', ' ', 'g')),
            btrim(regexp_replace(lower(coalesce(postal,'')), '[[:space:]]+', ' ', 'g')),
            btrim(regexp_replace(lower(coalesce(country,'')), '[[:space:]]+', ' ', 'g'))), 'sha256'), 'hex') $$;
        CREATE FUNCTION invalidate_location_geography() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF TG_OP='INSERT' OR ROW(NEW.address_line1,NEW.address_line2,NEW.city,NEW.region,NEW.postal_code,NEW.country_code,NEW.privacy)
            IS DISTINCT FROM ROW(OLD.address_line1,OLD.address_line2,OLD.city,OLD.region,OLD.postal_code,OLD.country_code,OLD.privacy) THEN
            NEW.county_fips:=NULL; NEW.geocode_address_hash:=NULL; NEW.geocode_source:=NULL;
            NEW.geocode_benchmark:=NULL; NEW.geocode_vintage:=NULL; NEW.geocoded_at:=NULL;
            NEW.geocode_attempts:=0; NEW.geocode_next_attempt_at:=NULL;
            NEW.geocode_status:=CASE WHEN NEW.privacy='public' AND upper(btrim(NEW.country_code))='US'
              AND nullif(btrim(NEW.address_line1),'') IS NOT NULL AND nullif(btrim(NEW.city),'') IS NOT NULL
              AND nullif(btrim(NEW.region),'') IS NOT NULL THEN 'pending' ELSE 'unsupported' END;
            IF TG_OP='UPDATE' THEN NEW.latitude:=NULL; NEW.longitude:=NULL; NEW.geo:=NULL; END IF;
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER locations_geography_invalidation BEFORE INSERT OR UPDATE ON locations
          FOR EACH ROW EXECUTE FUNCTION invalidate_location_geography();
        ALTER TABLE locations ADD CONSTRAINT locations_geocode_status_check
          CHECK (geocode_status IN ('unverified','pending','processing','matched','unmatched','ambiguous','error','unsupported'));
        ALTER TABLE locations ADD CONSTRAINT locations_geocode_attempts_check CHECK (geocode_attempts >= 0);
        ALTER TABLE locations ADD CONSTRAINT locations_county_fips_check CHECK (county_fips IS NULL OR county_fips ~ '^[0-9]{5}$');
        ALTER TABLE locations ADD CONSTRAINT locations_trusted_geography_check CHECK (geocode_status <> 'matched' OR (
          geocode_source IS NOT NULL AND geocode_source='census' AND privacy='public' AND upper(btrim(country_code))='US'
          AND geocode_benchmark IS NOT NULL AND geocode_vintage IS NOT NULL AND geocoded_at IS NOT NULL
          AND county_fips IS NOT NULL AND geocode_address_hash IS NOT NULL
          AND geocode_address_hash=location_address_hash(address_line1,address_line2,city,region,postal_code,country_code)
          AND latitude IS NOT NULL AND longitude IS NOT NULL AND geo IS NOT NULL
          AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
          AND ST_DWithin(geo,ST_SetSRID(ST_MakePoint(longitude,latitude),4326)::geography,1)));
        CREATE INDEX locations_geocode_queue_idx ON locations(geocode_next_attempt_at,updated_at,id)
          WHERE geocode_status IN ('pending','processing','error') AND privacy='public';
        CREATE INDEX locations_county_verified_idx ON locations(county_fips) WHERE geocode_status='matched';
        CREATE INDEX locations_discovery_locality_idx ON locations (
          (regexp_replace(regexp_replace(lower(btrim(city)), '[.''’]', '', 'g'), '[[:space:]_-]+', ' ', 'g')),
          (regexp_replace(regexp_replace(lower(btrim(region)), '[.''’]', '', 'g'), '[[:space:]_-]+', ' ', 'g')),
          (upper(btrim(country_code))));
      `, { transaction });
      // Existing points, including demo coordinates, remain unverified. This is
      // not a provider backfill or an assertion about historical address quality.
    });
  },
  async down(q) {
    await q.sequelize.transaction(async transaction => {
      // Fence provider completions before checking evidence. The lock and guard
      // share the DDL transaction, so a concurrent match cannot be discarded.
      await q.sequelize.query('LOCK TABLE locations IN ACCESS EXCLUSIVE MODE', { transaction });
      const [rows] = await q.sequelize.query("SELECT 1 FROM locations WHERE geocode_status='matched' LIMIT 1", { transaction });
      if (rows.length) throw new Error('Verified geography evidence exists; preserve it before rollback.');
      await q.sequelize.query(`DROP TRIGGER locations_geography_invalidation ON locations;
        DROP FUNCTION invalidate_location_geography();
        ALTER TABLE locations DROP CONSTRAINT locations_trusted_geography_check, DROP CONSTRAINT locations_county_fips_check,
          DROP CONSTRAINT locations_geocode_status_check, DROP CONSTRAINT locations_geocode_attempts_check;
        DROP INDEX locations_geocode_queue_idx; DROP INDEX locations_county_verified_idx; DROP INDEX locations_discovery_locality_idx;
        DROP FUNCTION location_address_hash(text,text,text,text,text,text);
        ALTER TABLE locations DROP COLUMN county_fips, DROP COLUMN geocode_status, DROP COLUMN geocode_source,
          DROP COLUMN geocode_address_hash, DROP COLUMN geocode_benchmark, DROP COLUMN geocode_vintage,
          DROP COLUMN geocoded_at, DROP COLUMN geocode_attempts, DROP COLUMN geocode_next_attempt_at;`, { transaction });
    });
  },
};
