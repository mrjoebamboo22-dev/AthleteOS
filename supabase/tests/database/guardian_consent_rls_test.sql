begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

-- Stable UUIDs used only inside this rolled-back test transaction.
\set guardian_id '11111111-1111-4111-8111-111111111111'
\set athlete_id '22222222-2222-4222-8222-222222222222'
\set stranger_id '33333333-3333-4333-8333-333333333333'

-- Structural checks.
select ok(
  (select relrowsecurity from pg_class where oid = 'public.guardian_athletes'::regclass),
  'RLS is enabled on guardian_athletes'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.guardian_consent_requests'::regclass),
  'RLS is enabled on guardian_consent_requests'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.guardian_consents'::regclass),
  'RLS is enabled on guardian_consents'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.consent_audit_events'::regclass),
  'RLS is enabled on consent_audit_events'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.data_deletion_requests'::regclass),
  'RLS is enabled on data_deletion_requests'
);

select has_function(
  'public',
  'revoke_guardian_consent',
  array['uuid', 'text'],
  'revoke_guardian_consent(uuid, text) exists'
);
select has_function(
  'public',
  'request_athlete_deletion',
  array['uuid', 'text'],
  'request_athlete_deletion(uuid, text) exists'
);
select has_function(
  'public',
  'grant_guardian_consent',
  array['uuid', 'jsonb', 'text', 'text'],
  'grant_guardian_consent(uuid, jsonb, text, text) exists'
);

-- Test identities. Adjust required auth.users columns if your local schema adds constraints.
insert into auth.users (id, email)
values
  (:'guardian_id'::uuid, 'guardian-test@example.invalid'),
  (:'athlete_id'::uuid, 'athlete-test@example.invalid'),
  (:'stranger_id'::uuid, 'stranger-test@example.invalid');

insert into public.profiles (id, display_name, role, account_status)
values
  (:'guardian_id'::uuid, 'Guardian Test', 'guardian', 'active'),
  (:'athlete_id'::uuid, 'Athlete Test', 'athlete', 'pending_guardian_consent'),
  (:'stranger_id'::uuid, 'Stranger Test', 'guardian', 'active');

insert into public.guardian_athletes (
  guardian_id, athlete_id, relationship_label, verified_at
)
values (
  :'guardian_id'::uuid, :'athlete_id'::uuid, 'guardian', now()
);

insert into public.guardian_consents (
  guardian_id,
  athlete_id,
  status,
  method,
  privacy_notice_version,
  terms_version,
  consent_scope,
  granted_at
)
values (
  :'guardian_id'::uuid,
  :'athlete_id'::uuid,
  'granted',
  'manual_review',
  '1.0',
  '1.0',
  '{"profile":true,"performance_metrics":true}'::jsonb,
  now()
);

insert into public.data_deletion_requests (
  athlete_id, requested_by, status
)
values (
  :'athlete_id'::uuid, :'guardian_id'::uuid, 'requested'
);

-- Authenticated guardian context.
set local role authenticated;
set local request.jwt.claim.sub = :'guardian_id';
set local request.jwt.claims = '{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111111","email":"guardian-test@example.invalid"}';

select results_eq(
  $$select count(*) from public.guardian_athletes where athlete_id = '22222222-2222-4222-8222-222222222222'::uuid$$,
  array[1::bigint],
  'Verified guardian can read their athlete link'
);
select results_eq(
  $$select count(*) from public.guardian_consents where athlete_id = '22222222-2222-4222-8222-222222222222'::uuid$$,
  array[1::bigint],
  'Guardian can read their consent record'
);
select results_eq(
  $$select count(*) from public.data_deletion_requests where athlete_id = '22222222-2222-4222-8222-222222222222'::uuid$$,
  array[1::bigint],
  'Guardian can read their deletion request'
);

-- Unrelated authenticated user must not see the athlete's protected records.
set local request.jwt.claim.sub = :'stranger_id';
set local request.jwt.claims = '{"role":"authenticated","sub":"33333333-3333-4333-8333-333333333333","email":"stranger-test@example.invalid"}';

select results_eq(
  $$select count(*) from public.guardian_athletes where athlete_id = '22222222-2222-4222-8222-222222222222'::uuid$$,
  array[0::bigint],
  'Unrelated user cannot read guardian-athlete links'
);
select results_eq(
  $$select count(*) from public.guardian_consents where athlete_id = '22222222-2222-4222-8222-222222222222'::uuid$$,
  array[0::bigint],
  'Unrelated user cannot read consent records'
);
select results_eq(
  $$select count(*) from public.data_deletion_requests where athlete_id = '22222222-2222-4222-8222-222222222222'::uuid$$,
  array[0::bigint],
  'Unrelated user cannot read deletion requests'
);

select * from finish();
rollback;
