'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE EXTENSION IF NOT EXISTS postgis;
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email varchar(320) NOT NULL UNIQUE,
        display_name varchar(120) NOT NULL, phone varchar(32), marketing_consent_at timestamptz,
        is_active boolean NOT NULL DEFAULT true, is_internal_admin boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE organizations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(160) NOT NULL, slug varchar(180) NOT NULL UNIQUE,
        description text, plan_tier varchar(20) NOT NULL DEFAULT 'free' CHECK (plan_tier IN ('free','gold')),
        status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE organization_owners (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, role varchar(20) NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','admin')),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id,user_id)
      );
      CREATE TABLE locations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(180), address_line1 varchar(180), address_line2 varchar(180),
        city varchar(100) NOT NULL, region varchar(100), postal_code varchar(24), country_code char(2) NOT NULL DEFAULT 'US',
        timezone varchar(64) NOT NULL, latitude numeric(9,6) CHECK (latitude BETWEEN -90 AND 90),
        longitude numeric(9,6) CHECK (longitude BETWEEN -180 AND 180), geo geography(POINT,4326),
        privacy varchar(24) NOT NULL DEFAULT 'public' CHECK (privacy IN ('public','attendees_only','private')),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX locations_geo_gix ON locations USING GIST (geo);
      CREATE TABLE events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), creator_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL, location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
        title varchar(180) NOT NULL, slug varchar(200) NOT NULL, summary varchar(500), description text, category varchar(80) NOT NULL DEFAULT 'other',
        status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','cancelled','completed')),
        starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, capacity integer CHECK (capacity >= 0),
        guestlist_capacity integer NOT NULL DEFAULT 0 CHECK (guestlist_capacity >= 0), is_discoverable boolean NOT NULL DEFAULT true,
        version integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (ends_at > starts_at), UNIQUE NULLS NOT DISTINCT (organization_id,slug)
      );
      CREATE INDEX events_discovery_idx ON events (status,starts_at) WHERE is_discoverable;
      CREATE INDEX events_location_time_idx ON events (location_id,starts_at);
      CREATE TABLE org_affiliates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, code varchar(48) NOT NULL UNIQUE,
        default_commission_bps integer NOT NULL DEFAULT 0 CHECK (default_commission_bps BETWEEN 0 AND 10000),
        default_guestlist_allocation integer NOT NULL DEFAULT 0 CHECK (default_guestlist_allocation >= 0),
        starts_at timestamptz, ends_at timestamptz, status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id,user_id)
      );
      CREATE TABLE event_affiliates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, org_affiliate_id uuid REFERENCES org_affiliates(id) ON DELETE SET NULL,
        code varchar(48) NOT NULL UNIQUE, commission_bps integer CHECK (commission_bps BETWEEN 0 AND 10000),
        guestlist_allocation integer CHECK (guestlist_allocation >= 0), starts_at timestamptz, ends_at timestamptz,
        status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (event_id,user_id)
      );
      CREATE TABLE offerings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        name varchar(160) NOT NULL, description text, kind varchar(24) NOT NULL DEFAULT 'ticket' CHECK (kind IN ('ticket','package','reservation')),
        price_cents integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0), currency char(3) NOT NULL DEFAULT 'USD',
        inventory_mode varchar(20) NOT NULL DEFAULT 'finite' CHECK (inventory_mode IN ('finite','unlimited')),
        quantity_total integer CHECK (quantity_total >= 0), quantity_sold integer NOT NULL DEFAULT 0 CHECK (quantity_sold >= 0),
        entries_per_unit integer NOT NULL DEFAULT 1 CHECK (entries_per_unit > 0), min_per_order integer NOT NULL DEFAULT 1 CHECK (min_per_order > 0),
        max_per_order integer NOT NULL DEFAULT 10 CHECK (max_per_order >= min_per_order), sales_start_at timestamptz, sales_end_at timestamptz,
        visibility varchar(20) NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','hidden','password')), access_code_hash varchar(128),
        is_active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (inventory_mode = 'unlimited' OR quantity_total IS NOT NULL), CHECK (quantity_total IS NULL OR quantity_sold <= quantity_total)
      );
      CREATE INDEX offerings_event_active_idx ON offerings (event_id,is_active,sort_order);
      CREATE TABLE orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
        status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled','refunded')), currency char(3) NOT NULL DEFAULT 'USD',
        subtotal_cents integer NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0), platform_fee_cents integer NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
        total_cents integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0), affiliate_commission_cents integer NOT NULL DEFAULT 0 CHECK (affiliate_commission_cents >= 0),
        org_affiliate_id uuid REFERENCES org_affiliates(id) ON DELETE SET NULL, event_affiliate_id uuid REFERENCES event_affiliates(id) ON DELETE SET NULL,
        pricing_plan_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb, idempotency_key varchar(100) NOT NULL, paid_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (buyer_user_id,idempotency_key)
      );
      CREATE INDEX orders_event_status_time_idx ON orders (event_id,status,created_at);
      CREATE TABLE order_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        offering_id uuid NOT NULL REFERENCES offerings(id) ON DELETE RESTRICT, name_snapshot varchar(160) NOT NULL, kind_snapshot varchar(40) NOT NULL,
        quantity integer NOT NULL CHECK (quantity > 0), entries_per_unit_snapshot integer NOT NULL CHECK (entries_per_unit_snapshot > 0),
        unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0), line_total_cents integer NOT NULL CHECK (line_total_cents >= 0),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX order_items_order_idx ON order_items (order_id); CREATE INDEX order_items_offering_idx ON order_items (offering_id);
      CREATE TABLE payments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
        provider varchar(40) NOT NULL DEFAULT 'manual', provider_reference varchar(160),
        status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','refunded')),
        amount_cents integer NOT NULL CHECK (amount_cents >= 0), currency char(3) NOT NULL DEFAULT 'USD', processed_at timestamptz, metadata jsonb,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE NULLS NOT DISTINCT (provider,provider_reference)
      );
      CREATE TABLE tickets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
        order_item_id uuid NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT, holder_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        qr_token_hash char(64) NOT NULL UNIQUE, status varchar(20) NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','checked_in','void','transferred')),
        checked_in_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX tickets_event_holder_idx ON tickets (event_id,holder_user_id);
      CREATE TABLE guestlist_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, event_affiliate_id uuid REFERENCES event_affiliates(id) ON DELETE SET NULL,
        source varchar(20) NOT NULL CHECK (source IN ('event','affiliate')), party_size integer NOT NULL DEFAULT 1 CHECK (party_size > 0),
        status varchar(20) NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','checked_in','cancelled','no_show')),
        qr_token_hash char(64) NOT NULL UNIQUE, checked_in_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (event_id,user_id),
        CHECK ((source = 'affiliate' AND event_affiliate_id IS NOT NULL) OR (source = 'event' AND event_affiliate_id IS NULL))
      );
      CREATE INDEX guestlist_affiliate_status_idx ON guestlist_entries (event_affiliate_id,status);
      CREATE TABLE check_ins (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
        ticket_id uuid UNIQUE REFERENCES tickets(id) ON DELETE RESTRICT, guestlist_entry_id uuid UNIQUE REFERENCES guestlist_entries(id) ON DELETE RESTRICT,
        checked_in_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        method varchar(20) NOT NULL DEFAULT 'qr' CHECK (method IN ('qr','manual')), checked_in_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK ((ticket_id IS NOT NULL)::integer + (guestlist_entry_id IS NOT NULL)::integer = 1)
      );
      CREATE TABLE affiliate_attributions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        user_id uuid REFERENCES users(id) ON DELETE SET NULL, org_affiliate_id uuid REFERENCES org_affiliates(id) ON DELETE SET NULL,
        event_affiliate_id uuid REFERENCES event_affiliates(id) ON DELETE SET NULL,
        action varchar(20) NOT NULL CHECK (action IN ('visit','guestlist','checkout','purchase')), session_key varchar(100),
        order_id uuid REFERENCES orders(id) ON DELETE SET NULL, occurred_at timestamptz NOT NULL DEFAULT now(), metadata jsonb,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX affiliate_attribution_event_time_idx ON affiliate_attributions (event_id,occurred_at);
      CREATE INDEX affiliate_attribution_event_affiliate_idx ON affiliate_attributions (event_affiliate_id,action);
      CREATE TABLE audit_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL, entity_type varchar(80) NOT NULL, entity_id uuid NOT NULL,
        action varchar(80) NOT NULL, before jsonb, after jsonb, request_id varchar(100), ip_address inet,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX audit_entity_idx ON audit_logs (entity_type,entity_id,created_at); CREATE INDEX audit_org_idx ON audit_logs (organization_id,created_at);
      CREATE TABLE boosts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
        status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','active','completed','cancelled')),
        starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, budget_cents integer NOT NULL CHECK (budget_cents >= 0),
        discount_bps_snapshot integer NOT NULL DEFAULT 0 CHECK (discount_bps_snapshot BETWEEN 0 AND 10000),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CHECK (ends_at > starts_at)
      );
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS boosts, audit_logs, affiliate_attributions, check_ins, guestlist_entries, tickets, payments,
        order_items, orders, offerings, event_affiliates, org_affiliates, events, locations, organization_owners, organizations, users CASCADE;
    `);
  },
};

