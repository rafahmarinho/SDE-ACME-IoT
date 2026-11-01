-- ACME IoT round 2: server-authoritative data access (SD Elements T17, T145, T378, T2598, T2600,
-- T2602, T349, T742, T338). Additive migration applied after 20261019_security_hardening.sql.
-- The account x object chart it implements is versioned in supabase/access-matrix.json; the security
-- checks (scripts/verify-security-controls.ts) compare the chart with the effective policies and grants.

-- 1. Location and device helpers used by WITH CHECK clauses (SECURITY INVOKER: they only see what the
--    caller's own RLS policies allow).
CREATE OR REPLACE FUNCTION public.is_org_device(p_device_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.devices d
        WHERE d.id = p_device_id AND d.organization_id = public.current_user_org_id()
    );
$$;

CREATE OR REPLACE FUNCTION public.is_org_location(p_building_id uuid, p_room_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.rooms r JOIN public.buildings b ON b.id = r.building_id
        WHERE r.id = p_room_id AND b.id = p_building_id AND b.organization_id = public.current_user_org_id()
    );
$$;

REVOKE EXECUTE ON FUNCTION public.is_org_device(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_org_location(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_org_device(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_location(uuid, uuid) TO authenticated;

-- 2. Write policies with explicit WITH CHECK: new and changed rows must stay in the caller's
--    organization, reference only its own buildings, rooms and devices, and keep the role rules.
DROP POLICY IF EXISTS buildings_write_policy ON public.buildings;
CREATE POLICY buildings_write_policy ON public.buildings
    FOR ALL TO authenticated
    USING (organization_id = public.current_user_org_id() AND public.current_user_role() IN ('owner', 'administrator'))
    WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() IN ('owner', 'administrator'));

DROP POLICY IF EXISTS rooms_write_policy ON public.rooms;
CREATE POLICY rooms_write_policy ON public.rooms
    FOR ALL TO authenticated
    USING (
        public.current_user_role() IN ('owner', 'administrator') AND
        building_id IN (SELECT b.id FROM public.buildings b WHERE b.organization_id = public.current_user_org_id())
    )
    WITH CHECK (
        public.current_user_role() IN ('owner', 'administrator') AND
        building_id IN (SELECT b.id FROM public.buildings b WHERE b.organization_id = public.current_user_org_id())
    );

DROP POLICY IF EXISTS devices_control_policy ON public.devices;
CREATE POLICY devices_control_policy ON public.devices
    FOR UPDATE TO authenticated
    USING (organization_id = public.current_user_org_id() AND public.current_user_role() IN ('owner', 'administrator', 'operator'))
    WITH CHECK (
        organization_id = public.current_user_org_id() AND
        public.current_user_role() IN ('owner', 'administrator', 'operator') AND
        public.is_org_location(building_id, room_id)
    );

DROP POLICY IF EXISTS devices_admin_policy ON public.devices;
CREATE POLICY devices_admin_policy ON public.devices
    FOR ALL TO authenticated
    USING (organization_id = public.current_user_org_id() AND public.current_user_role() IN ('owner', 'administrator'))
    WITH CHECK (
        organization_id = public.current_user_org_id() AND
        public.current_user_role() IN ('owner', 'administrator') AND
        public.is_org_location(building_id, room_id)
    );

DROP POLICY IF EXISTS automations_write_policy ON public.automations;
CREATE POLICY automations_write_policy ON public.automations
    FOR ALL TO authenticated
    USING (organization_id = public.current_user_org_id() AND public.current_user_role() IN ('owner', 'administrator', 'operator'))
    WITH CHECK (
        organization_id = public.current_user_org_id() AND
        public.current_user_role() IN ('owner', 'administrator', 'operator') AND
        -- An enabled rule may only reference devices of the organization; disabling is always allowed.
        (NOT enabled OR (
            (public.is_org_device((trigger_condition ->> 'device_id')::uuid) OR
             (trigger_type = 'schedule' AND trigger_condition ->> 'device_id' IS NULL)) AND
            public.is_org_device((action ->> 'target_device_id')::uuid)))
    );

DROP POLICY IF EXISTS alerts_update_policy ON public.alerts;
CREATE POLICY alerts_update_policy ON public.alerts
    FOR UPDATE TO authenticated
    USING (organization_id = public.current_user_org_id() AND public.current_user_role() IN ('owner', 'administrator', 'operator'))
    WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() IN ('owner', 'administrator', 'operator'));

DROP POLICY IF EXISTS integrations_write_policy ON public.integrations;
CREATE POLICY integrations_write_policy ON public.integrations
    FOR ALL TO authenticated
    USING (organization_id = public.current_user_org_id() AND public.current_user_role() IN ('owner', 'administrator'))
    WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() IN ('owner', 'administrator'));

-- Profiles hold personal data: members read their own profile; only team managers read the others.
DROP POLICY IF EXISTS profile_read_policy ON public.user_profiles;
CREATE POLICY profile_read_policy ON public.user_profiles
    FOR SELECT TO authenticated
    USING (
        id = auth.uid() OR
        (organization_id = public.current_user_org_id() AND public.current_user_role() IN ('owner', 'administrator'))
    );

-- 3. Alert workflow: users only change the status; who acknowledged it and when it was resolved
--    are set here from the authenticated caller, and resolved alerts cannot be reopened.
CREATE OR REPLACE FUNCTION public.enforce_alert_transition()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
    IF OLD.status = 'resolved' AND NEW.status IS DISTINCT FROM 'resolved' THEN
        RAISE EXCEPTION 'resolved alerts cannot be reopened' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'acknowledged' AND OLD.status IS DISTINCT FROM 'acknowledged' THEN
        NEW.acknowledged_by := auth.uid();
    ELSIF NEW.status = 'resolved' AND OLD.status IS DISTINCT FROM 'resolved' THEN
        NEW.resolved_at := pg_catalog.now();
        NEW.acknowledged_by := COALESCE(OLD.acknowledged_by, auth.uid());
    END IF;
    RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enforce_alert_transition() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS alerts_transition_guard ON public.alerts;
CREATE TRIGGER alerts_transition_guard
    BEFORE UPDATE ON public.alerts
    FOR EACH ROW EXECUTE FUNCTION public.enforce_alert_transition();

-- 4. Team invitations (members are invited by managers; accounts are created when they accept).
CREATE TABLE IF NOT EXISTS public.team_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    email VARCHAR(254) NOT NULL CHECK (email = lower(email) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    full_name VARCHAR(100) NOT NULL CHECK (length(btrim(full_name)) >= 2),
    role VARCHAR(50) NOT NULL CHECK (role IN ('administrator', 'operator', 'viewer')),
    invited_by UUID NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS team_invitations_pending_email_key
    ON public.team_invitations (organization_id, email) WHERE status = 'pending';
ALTER TABLE public.team_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY team_invitations_read_policy ON public.team_invitations
    FOR SELECT TO authenticated
    USING (organization_id = public.current_user_org_id() AND public.current_user_role() IN ('owner', 'administrator'));

CREATE POLICY team_invitations_insert_policy ON public.team_invitations
    FOR INSERT TO authenticated
    WITH CHECK (
        organization_id = public.current_user_org_id() AND
        invited_by = auth.uid() AND
        status = 'pending' AND
        (public.current_user_role() = 'owner' OR
         (public.current_user_role() = 'administrator' AND role IN ('operator', 'viewer')))
    );

CREATE POLICY team_invitations_update_policy ON public.team_invitations
    FOR UPDATE TO authenticated
    USING (
        organization_id = public.current_user_org_id() AND public.current_user_role() IN ('owner', 'administrator') AND
        (public.current_user_role() = 'owner' OR role IN ('operator', 'viewer'))
    )
    WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() IN ('owner', 'administrator') AND status = 'revoked');

-- 5. Column-level least privilege (SDE T2598). Telemetry, counters, secrets and identity columns are
--    written only by the platform (service role) or by triggers.
REVOKE ALL ON public.team_invitations FROM anon;
REVOKE ALL ON public.team_invitations FROM authenticated;
GRANT SELECT ON public.team_invitations TO authenticated;
GRANT INSERT (organization_id, email, full_name, role, invited_by) ON public.team_invitations TO authenticated;
GRANT UPDATE (status) ON public.team_invitations TO authenticated;

REVOKE INSERT, UPDATE ON public.devices FROM authenticated;
GRANT INSERT (organization_id, building_id, room_id, name, code, type, desired_state) ON public.devices TO authenticated;
GRANT UPDATE (name, building_id, room_id, desired_state) ON public.devices TO authenticated;

REVOKE UPDATE ON public.alerts FROM authenticated;
GRANT UPDATE (status) ON public.alerts TO authenticated;

REVOKE INSERT, UPDATE ON public.automations FROM authenticated;
GRANT INSERT (organization_id, name, enabled, trigger_type, trigger_condition, action, interval_seconds, notify_on_run) ON public.automations TO authenticated;
GRANT UPDATE (name, enabled, trigger_type, trigger_condition, action, interval_seconds, notify_on_run) ON public.automations TO authenticated;

-- The API key hash is never readable by end users.
REVOKE SELECT, INSERT, UPDATE ON public.integrations FROM authenticated;
GRANT SELECT (id, organization_id, name, type, endpoint_url, active, created_at) ON public.integrations TO authenticated;
GRANT INSERT (organization_id, name, type, endpoint_url, active) ON public.integrations TO authenticated;
GRANT UPDATE (name, endpoint_url, active) ON public.integrations TO authenticated;

-- Rollouts are history: they can be started and rolled back, never deleted.
REVOKE INSERT, UPDATE, DELETE ON public.firmware_rollouts FROM authenticated;
GRANT INSERT (organization_id, firmware_id, target_type, total_devices, status, progress_percent) ON public.firmware_rollouts TO authenticated;
GRANT UPDATE (status, progress_percent) ON public.firmware_rollouts TO authenticated;

-- E-mail and organization are never changed by end users (e-mail follows auth.users, see section 6).
REVOKE INSERT, UPDATE ON public.user_profiles FROM authenticated;
GRANT UPDATE (full_name, role) ON public.user_profiles TO authenticated;

-- 6. Accuracy of personal information (SDE T742): one profile per e-mail address, validated names,
--    and e-mail changes confirmed in Supabase Auth are propagated to the profile.
UPDATE public.user_profiles SET email = lower(email) WHERE email <> lower(email);
UPDATE public.user_profiles SET full_name = left(btrim(full_name), 100) WHERE full_name <> left(btrim(full_name), 100);
UPDATE public.user_profiles SET full_name = 'Member ' || left(id::text, 8) WHERE length(btrim(full_name)) < 2;
CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_email_lower_key ON public.user_profiles (lower(email));
-- Validated now (existing rows were normalized above), so later updates such as the e-mail sync never trip on legacy data.
ALTER TABLE public.user_profiles
    ADD CONSTRAINT user_profiles_email_lowercase CHECK (email = lower(email));
ALTER TABLE public.user_profiles
    ADD CONSTRAINT user_profiles_full_name_length CHECK (length(btrim(full_name)) BETWEEN 2 AND 100);

CREATE OR REPLACE FUNCTION public.sync_profile_email()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    IF NEW.email IS NOT NULL AND NEW.email IS DISTINCT FROM OLD.email THEN
        UPDATE public.user_profiles SET email = lower(NEW.email) WHERE id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sync_profile_email() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS on_auth_user_email_change ON auth.users;
CREATE TRIGGER on_auth_user_email_change
    AFTER UPDATE OF email ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.sync_profile_email();

-- 7. Tamper-evident audit trail (SDE T349). Every entry is chained to the previous entry of its
--    organization with SHA-256; entries can only be appended (no UPDATE, DELETE or TRUNCATE), the
--    only removal path is the retention purge below, and verify_events_log_chain() re-checks them.
ALTER TABLE public.events_log ADD COLUMN IF NOT EXISTS chain_seq BIGINT;
ALTER TABLE public.events_log ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE public.events_log ADD COLUMN IF NOT EXISTS entry_hash TEXT;
CREATE SEQUENCE IF NOT EXISTS public.events_log_chain_seq;
REVOKE ALL ON SEQUENCE public.events_log_chain_seq FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS idx_events_org_chain ON public.events_log (organization_id, chain_seq DESC);
-- Audit entries outlive the devices they mention: no cascading delete from devices.
ALTER TABLE public.events_log DROP CONSTRAINT IF EXISTS events_log_device_id_fkey;

CREATE OR REPLACE FUNCTION public.events_log_entry_hash(e public.events_log)
RETURNS text
LANGUAGE sql STABLE SET search_path = ''
AS $$
    SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.concat_ws('|',
        COALESCE(e.prev_hash, ''), e.id::text, e.organization_id::text, COALESCE(e.device_id::text, ''),
        e.event_type, COALESCE(e.actor_id::text, ''), COALESCE(e.actor_role, ''), e.payload::text,
        pg_catalog.to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
    ), 'UTF8')), 'hex');
$$;

-- Existing entries are chained once, in their original order, before the table becomes append-only.
-- The lock keeps concurrent writers out until the chaining trigger exists.
LOCK TABLE public.events_log IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE
    rec public.events_log;
    last_org uuid := NULL;
    last_hash text := NULL;
BEGIN
    FOR rec IN SELECT * FROM public.events_log ORDER BY organization_id, created_at, id LOOP
        IF last_org IS DISTINCT FROM rec.organization_id THEN
            last_hash := NULL;
            last_org := rec.organization_id;
        END IF;
        rec.chain_seq := pg_catalog.nextval('public.events_log_chain_seq');
        rec.prev_hash := last_hash;
        rec.entry_hash := public.events_log_entry_hash(rec);
        UPDATE public.events_log
           SET chain_seq = rec.chain_seq, prev_hash = rec.prev_hash, entry_hash = rec.entry_hash
         WHERE id = rec.id;
        last_hash := rec.entry_hash;
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.events_log_chain()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    -- One writer per organization at a time keeps each chain linear.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.organization_id::text, 0));
    NEW.created_at := pg_catalog.now();
    NEW.chain_seq := pg_catalog.nextval('public.events_log_chain_seq');
    SELECT l.entry_hash INTO NEW.prev_hash
      FROM public.events_log l
     WHERE l.organization_id = NEW.organization_id AND l.entry_hash IS NOT NULL
     ORDER BY l.chain_seq DESC
     LIMIT 1;
    NEW.entry_hash := public.events_log_entry_hash(NEW);
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.events_log_append_only()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
    -- Only the retention purge, running as the table owner with an explicit flag, may delete.
    IF TG_OP = 'DELETE'
       AND pg_catalog.current_setting('acme.audit_purge', true) = 'on'
       AND current_user::text = (SELECT c.relowner::regrole::text FROM pg_catalog.pg_class c WHERE c.oid = 'public.events_log'::regclass) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'events_log is append-only: % refused', TG_OP USING ERRCODE = '42501';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.events_log_entry_hash(public.events_log) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.events_log_chain() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.events_log_append_only() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS events_log_hash_chain ON public.events_log;
CREATE TRIGGER events_log_hash_chain
    BEFORE INSERT ON public.events_log
    FOR EACH ROW EXECUTE FUNCTION public.events_log_chain();
DROP TRIGGER IF EXISTS events_log_no_change ON public.events_log;
CREATE TRIGGER events_log_no_change
    BEFORE UPDATE OR DELETE ON public.events_log
    FOR EACH ROW EXECUTE FUNCTION public.events_log_append_only();
DROP TRIGGER IF EXISTS events_log_no_truncate ON public.events_log;
CREATE TRIGGER events_log_no_truncate
    BEFORE TRUNCATE ON public.events_log
    FOR EACH STATEMENT EXECUTE FUNCTION public.events_log_append_only();

-- Re-verifies the newest entries of the caller's organization (bounded window, SDE T2600). It runs as
-- the owner so entries hidden from the caller (see events_sensitive_read_policy) still count in the chain;
-- it only returns the result, never their content.
CREATE OR REPLACE FUNCTION public.verify_events_log_chain(max_entries integer DEFAULT 200)
RETURNS TABLE (verified boolean, checked_entries bigint, first_invalid_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    rec public.events_log;
    expected_prev text := NULL;
    is_first boolean := true;
    checked bigint := 0;
BEGIN
    FOR rec IN
        SELECT w.* FROM (
            SELECT l.* FROM public.events_log l
             WHERE l.organization_id = public.current_user_org_id() AND l.entry_hash IS NOT NULL
             ORDER BY l.chain_seq DESC
             LIMIT LEAST(GREATEST(max_entries, 1), 1000)
        ) w
        ORDER BY w.chain_seq ASC
    LOOP
        IF (NOT is_first AND rec.prev_hash IS DISTINCT FROM expected_prev)
           OR rec.entry_hash IS DISTINCT FROM public.events_log_entry_hash(rec) THEN
            RETURN QUERY SELECT false, checked, rec.id;
            RETURN;
        END IF;
        is_first := false;
        expected_prev := rec.entry_hash;
        checked := checked + 1;
    END LOOP;
    RETURN QUERY SELECT true, checked, NULL::uuid;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.verify_events_log_chain(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_events_log_chain(integer) TO authenticated;

-- Retention: entries older than the retention period (at least one year) are destroyed by the platform
-- only, and every purge leaves its own audit entry.
CREATE OR REPLACE FUNCTION public.purge_events_log(retention_days integer)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    org uuid;
    removed bigint;
    total bigint := 0;
    cutoff timestamptz;
BEGIN
    IF retention_days IS NULL OR retention_days < 365 THEN
        RAISE EXCEPTION 'audit entries are kept for at least 365 days';
    END IF;
    cutoff := pg_catalog.now() - pg_catalog.make_interval(days => retention_days);
    FOR org IN SELECT DISTINCT l.organization_id FROM public.events_log l WHERE l.created_at < cutoff LOOP
        PERFORM pg_catalog.set_config('acme.audit_purge', 'on', true);
        DELETE FROM public.events_log WHERE organization_id = org AND created_at < cutoff;
        GET DIAGNOSTICS removed = ROW_COUNT;
        PERFORM pg_catalog.set_config('acme.audit_purge', 'off', true);
        INSERT INTO public.events_log (organization_id, event_type, actor_role, payload)
        VALUES (org, 'audit_purge', 'system', pg_catalog.jsonb_build_object('retention_days', retention_days, 'removed', removed));
        total := total + removed;
    END LOOP;
    RETURN total;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.purge_events_log(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_events_log(integer) TO service_role;

-- 8. Data change log (SDE T2602): every change to tenant data is appended to events_log with the
--    table, operation, record id, actor and changed values. Secrets are never copied and personal
--    fields are only marked as changed; device telemetry is kept in telemetry_readings instead.
CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    old_row jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN pg_catalog.to_jsonb(OLD) END;
    new_row jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN pg_catalog.to_jsonb(NEW) END;
    row_data jsonb := COALESCE(new_row, old_row);
    org uuid;
    changes jsonb := '{}'::jsonb;
    col text;
    secret_cols text[] := ARRAY['api_key_hash', 'endpoint_url'];
    personal_cols text[] := ARRAY['email', 'full_name'];
    telemetry_cols text[] := ARRAY['reported_state', 'battery_level', 'rssi', 'status', 'firmware_version', 'last_seen_at'];
BEGIN
    IF TG_TABLE_NAME = 'rooms' THEN
        SELECT b.organization_id INTO org FROM public.buildings b WHERE b.id = (row_data ->> 'building_id')::uuid;
    ELSE
        org := (row_data ->> 'organization_id')::uuid;
    END IF;
    IF org IS NULL THEN
        RETURN NULL;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        FOR col IN SELECT k FROM pg_catalog.jsonb_object_keys(new_row) AS k LOOP
            IF (new_row -> col) IS DISTINCT FROM (old_row -> col) THEN
                changes := changes || pg_catalog.jsonb_build_object(col, CASE
                    WHEN col = ANY (secret_cols) THEN pg_catalog.to_jsonb('[redacted]'::text)
                    WHEN col = ANY (personal_cols) THEN pg_catalog.to_jsonb('[changed]'::text)
                    ELSE pg_catalog.jsonb_build_object('old', old_row -> col, 'new', new_row -> col)
                END);
            END IF;
        END LOOP;
        IF changes = '{}'::jsonb THEN
            RETURN NULL;
        END IF;
        IF TG_TABLE_NAME = 'devices'
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(changes) AS k WHERE k <> ALL (telemetry_cols)) THEN
            RETURN NULL;
        END IF;
    ELSE
        changes := row_data - secret_cols;
        FOREACH col IN ARRAY personal_cols LOOP
            IF changes ? col THEN
                changes := changes || pg_catalog.jsonb_build_object(col, '[set]');
            END IF;
        END LOOP;
    END IF;

    INSERT INTO public.events_log (organization_id, event_type, actor_id, actor_role, payload)
    VALUES (
        org,
        'data_change',
        auth.uid(),
        COALESCE(public.current_user_role(), 'system'),
        pg_catalog.jsonb_build_object('table', TG_TABLE_NAME, 'operation', TG_OP, 'record_id', row_data ->> 'id', 'changes', changes)
    );
    RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.audit_row_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audit_buildings ON public.buildings;
CREATE TRIGGER audit_buildings AFTER INSERT OR UPDATE OR DELETE ON public.buildings FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
DROP TRIGGER IF EXISTS audit_rooms ON public.rooms;
CREATE TRIGGER audit_rooms AFTER INSERT OR UPDATE OR DELETE ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
DROP TRIGGER IF EXISTS audit_devices ON public.devices;
CREATE TRIGGER audit_devices AFTER INSERT OR UPDATE OR DELETE ON public.devices FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
DROP TRIGGER IF EXISTS audit_automations ON public.automations;
CREATE TRIGGER audit_automations AFTER INSERT OR UPDATE OR DELETE ON public.automations FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
DROP TRIGGER IF EXISTS audit_alerts ON public.alerts;
CREATE TRIGGER audit_alerts AFTER INSERT OR UPDATE OR DELETE ON public.alerts FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
DROP TRIGGER IF EXISTS audit_firmware_rollouts ON public.firmware_rollouts;
CREATE TRIGGER audit_firmware_rollouts AFTER INSERT OR UPDATE OR DELETE ON public.firmware_rollouts FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
DROP TRIGGER IF EXISTS audit_integrations ON public.integrations;
CREATE TRIGGER audit_integrations AFTER INSERT OR UPDATE OR DELETE ON public.integrations FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
DROP TRIGGER IF EXISTS audit_user_profiles ON public.user_profiles;
CREATE TRIGGER audit_user_profiles AFTER INSERT OR UPDATE OR DELETE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
DROP TRIGGER IF EXISTS audit_team_invitations ON public.team_invitations;
CREATE TRIGGER audit_team_invitations AFTER INSERT OR UPDATE OR DELETE ON public.team_invitations FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

-- 9. Step-up authentication (SDE T338): other members' profiles (personal data), team invitations and
--    integrations (secret-bearing endpoints) need a session verified with a second factor (aal2).
--    RESTRICTIVE policies are combined with AND on top of the role and tenant policies above.
CREATE POLICY profile_step_up_policy ON public.user_profiles
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (id = auth.uid() OR (auth.jwt() ->> 'aal') = 'aal2')
    WITH CHECK (id = auth.uid() OR (auth.jwt() ->> 'aal') = 'aal2');

CREATE POLICY team_invitations_step_up_policy ON public.team_invitations
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (organization_id = public.current_user_org_id() AND (auth.jwt() ->> 'aal') = 'aal2')
    WITH CHECK (organization_id = public.current_user_org_id() AND (auth.jwt() ->> 'aal') = 'aal2');

CREATE POLICY integrations_step_up_policy ON public.integrations
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (organization_id = public.current_user_org_id() AND (auth.jwt() ->> 'aal') = 'aal2')
    WITH CHECK (organization_id = public.current_user_org_id() AND (auth.jwt() ->> 'aal') = 'aal2');

-- 10. Consent records (SDE T178, T604, T754). Every decision is appended (never edited) with the
--     purpose, the decision, the notice version, the language, the authenticated user and the server
--     time; the latest decision per purpose for the current notice version is the one that counts.
CREATE TABLE IF NOT EXISTS public.privacy_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL DEFAULT auth.uid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    purpose VARCHAR(50) NOT NULL CHECK (purpose IN ('incident_alert_emails', 'automation_event_emails', 'daily_digest_emails')),
    granted BOOLEAN NOT NULL,
    notice_version VARCHAR(20) NOT NULL,
    locale VARCHAR(10) NOT NULL CHECK (locale IN ('en', 'pt-BR')),
    decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_privacy_consents_user ON public.privacy_consents (user_id, purpose, decided_at DESC);
ALTER TABLE public.privacy_consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY privacy_consents_read_policy ON public.privacy_consents
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY privacy_consents_insert_policy ON public.privacy_consents
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid() AND organization_id = public.current_user_org_id());

REVOKE ALL ON public.privacy_consents FROM anon;
REVOKE ALL ON public.privacy_consents FROM authenticated;
GRANT SELECT ON public.privacy_consents TO authenticated;
GRANT INSERT (organization_id, purpose, granted, notice_version, locale) ON public.privacy_consents TO authenticated;

DROP TRIGGER IF EXISTS audit_privacy_consents ON public.privacy_consents;
CREATE TRIGGER audit_privacy_consents AFTER INSERT OR UPDATE OR DELETE ON public.privacy_consents FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

-- Processing check: the platform may only e-mail a member for a purpose while the member's latest
-- decision for the current notice version grants it (a withdrawal stops it at once).
CREATE OR REPLACE FUNCTION public.consented_recipients(p_purpose text, p_notice_version text)
RETURNS TABLE (user_id uuid, organization_id uuid, email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT p.id, p.organization_id, p.email::text
      FROM public.user_profiles p
      JOIN LATERAL (
          SELECT c.granted
            FROM public.privacy_consents c
           WHERE c.user_id = p.id AND c.purpose = p_purpose AND c.notice_version = p_notice_version
           ORDER BY c.decided_at DESC, c.id DESC
           LIMIT 1
      ) latest ON latest.granted;
$$;
REVOKE EXECUTE ON FUNCTION public.consented_recipients(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consented_recipients(text, text) TO service_role;

-- 11. Audit entries follow the rules of the data they describe (SDE T349, T338, T604). Entries about
--     integrations, team invitations and profiles are only readable by owners/administrators with a
--     second factor; entries about consent decisions only by the member who made them.
CREATE POLICY events_sensitive_read_policy ON public.events_log
    AS RESTRICTIVE FOR SELECT TO authenticated
    USING (
        COALESCE(payload ->> 'table', '') NOT IN ('integrations', 'team_invitations', 'user_profiles', 'privacy_consents') OR
        (payload ->> 'table' = 'privacy_consents' AND actor_id = auth.uid()) OR
        (payload ->> 'table' IN ('integrations', 'team_invitations', 'user_profiles') AND
         public.current_user_role() IN ('owner', 'administrator') AND (auth.jwt() ->> 'aal') = 'aal2')
    );

-- 12. Direct Data API writes are validated as strictly as /api (SDE T378, T17): device setpoints,
--     integration endpoints, rollouts and automation rules cannot be stored in a shape the API refuses.
CREATE OR REPLACE FUNCTION public.validate_device_desired_state()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
    allowed text[];
    k text;
    v jsonb;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.desired_state IS NOT DISTINCT FROM OLD.desired_state AND NEW.type IS NOT DISTINCT FROM OLD.type THEN
            RETURN NEW;
        END IF;
    END IF;
    IF pg_catalog.jsonb_typeof(NEW.desired_state) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'desired_state must be a JSON object' USING ERRCODE = '23514';
    END IF;
    allowed := CASE NEW.type
        WHEN 'thermostat' THEN ARRAY['target_temp', 'mode']
        WHEN 'smart_plug' THEN ARRAY['power']
        WHEN 'occupancy_sensor' THEN ARRAY['sensitivity', 'sampling_rate']
        ELSE ARRAY['sampling_rate']
    END;
    FOR k, v IN SELECT e.key, e.value FROM pg_catalog.jsonb_each(NEW.desired_state) AS e LOOP
        IF NOT (k = ANY (allowed)) OR NOT CASE k
            WHEN 'target_temp' THEN CASE WHEN pg_catalog.jsonb_typeof(v) = 'number' THEN (v #>> '{}')::numeric BETWEEN -40 AND 60 ELSE false END
            WHEN 'sampling_rate' THEN CASE WHEN pg_catalog.jsonb_typeof(v) = 'number' THEN (v #>> '{}')::numeric BETWEEN 1 AND 3600 AND (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric) ELSE false END
            WHEN 'mode' THEN (v #>> '{}') IN ('cooling', 'heating', 'eco', 'off') AND pg_catalog.jsonb_typeof(v) = 'string'
            WHEN 'power' THEN (v #>> '{}') IN ('on', 'off') AND pg_catalog.jsonb_typeof(v) = 'string'
            WHEN 'sensitivity' THEN (v #>> '{}') IN ('low', 'medium', 'high') AND pg_catalog.jsonb_typeof(v) = 'string'
            ELSE false
        END THEN
            RAISE EXCEPTION 'desired_state % is not valid for a %', k, NEW.type USING ERRCODE = '23514';
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.validate_device_desired_state() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS devices_desired_state_guard ON public.devices;
CREATE TRIGGER devices_desired_state_guard
    BEFORE INSERT OR UPDATE ON public.devices
    FOR EACH ROW EXECUTE FUNCTION public.validate_device_desired_state();

-- Integration endpoints: external https URLs without credentials (no loopback, private or link-local hosts).
ALTER TABLE public.integrations
    ADD CONSTRAINT integrations_endpoint_external_https CHECK (
        endpoint_url IS NULL OR (
            endpoint_url ~ '^https://[^/@[:space:]]+(/.*)?$' AND
            endpoint_url !~* '^https://(localhost|127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|\[)'
        )
    ) NOT VALID;

-- Rollouts started by members begin in progress at 0% for a released or testing package with a valid
-- SHA-256 digest (the device count comes from the database); members can only roll them back.
CREATE OR REPLACE FUNCTION public.guard_firmware_rollout()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
    IF current_user::text <> 'authenticated' THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'in_progress' OR NEW.progress_percent <> 0 THEN
            RAISE EXCEPTION 'new rollouts start in progress at 0 percent' USING ERRCODE = '23514';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM public.firmware_packages p
             WHERE p.id = NEW.firmware_id AND p.status <> 'deprecated' AND p.device_type = NEW.target_type
               AND p.checksum_sha256 ~ '^[0-9a-fA-F]{64}$'
        ) THEN
            RAISE EXCEPTION 'this firmware package cannot be rolled out' USING ERRCODE = '23514';
        END IF;
        NEW.total_devices := (
            SELECT count(*) FROM public.devices d
             WHERE d.organization_id = NEW.organization_id AND d.type = NEW.target_type
        );
    ELSIF NOT (NEW.status = 'rolled_back' AND NEW.progress_percent = 0 AND OLD.status IS DISTINCT FROM 'rolled_back') THEN
        RAISE EXCEPTION 'members can only roll back a rollout' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guard_firmware_rollout() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS firmware_rollouts_guard ON public.firmware_rollouts;
CREATE TRIGGER firmware_rollouts_guard
    BEFORE INSERT OR UPDATE ON public.firmware_rollouts
    FOR EACH ROW EXECUTE FUNCTION public.guard_firmware_rollout();

-- Automation rules: bounded interval and known operators and commands.
ALTER TABLE public.automations
    ADD CONSTRAINT automations_rule_shape CHECK (
        interval_seconds BETWEEN 10 AND 86400 AND
        COALESCE(trigger_condition ->> 'operator', '>=') IN ('>', '<', '>=', '<=', '==', '!=') AND
        COALESCE(action ->> 'command', '') IN ('set_target_temp', 'set_power', 'set_mode')
    ) NOT VALID;
