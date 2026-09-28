-- Athlete OS guardian consent schema for local Supabase testing
create type public.app_role as enum ('athlete', 'guardian', 'coach', 'school_admin');
create type public.consent_status as enum ('pending', 'granted', 'declined', 'revoked', 'expired');
create type public.consent_method as enum ('email_plus', 'signed_form', 'payment_card', 'government_id', 'video_call', 'manual_review');
create type public.deletion_status as enum ('requested', 'identity_verification_required', 'verified', 'processing', 'completed', 'partially_completed', 'rejected', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 100),
  role public.app_role not null,
  date_of_birth date,
  guardian_consent_required boolean not null default false,
  account_status text not null default 'active' check (account_status in ('pending_guardian_consent','active','suspended','deletion_requested')),
  created_at timestamptz not null default now()
);

create table public.guardian_athletes (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references public.profiles(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  relationship_label text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (guardian_id, athlete_id),
  check (guardian_id <> athlete_id)
);

create table public.guardian_consent_requests (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  guardian_email text not null,
  requested_by uuid not null references public.profiles(id),
  token_hash text not null unique,
  status public.consent_status not null default 'pending',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create table public.guardian_consents (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references public.profiles(id),
  athlete_id uuid not null references public.profiles(id),
  request_id uuid references public.guardian_consent_requests(id),
  status public.consent_status not null,
  method public.consent_method not null,
  privacy_notice_version text not null,
  terms_version text not null,
  consent_scope jsonb not null default '{}'::jsonb,
  granted_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now()
);

create table public.consent_audit_events (
  id bigint generated always as identity primary key,
  consent_id uuid references public.guardian_consents(id),
  athlete_id uuid not null references public.profiles(id),
  actor_id uuid references public.profiles(id),
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.data_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id),
  requested_by uuid not null references public.profiles(id),
  status public.deletion_status not null default 'requested',
  request_reason text,
  verification_method text,
  verified_at timestamptz,
  processing_started_at timestamptz,
  completed_at timestamptz,
  retention_exceptions jsonb not null default '[]'::jsonb,
  failure_details text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index guardian_athletes_guardian_idx on public.guardian_athletes(guardian_id);
create index guardian_athletes_athlete_idx on public.guardian_athletes(athlete_id);
create index guardian_consents_athlete_idx on public.guardian_consents(athlete_id, status);
create index deletion_requests_athlete_idx on public.data_deletion_requests(athlete_id, status);

alter table public.profiles enable row level security;
alter table public.guardian_athletes enable row level security;
alter table public.guardian_consent_requests enable row level security;
alter table public.guardian_consents enable row level security;
alter table public.consent_audit_events enable row level security;
alter table public.data_deletion_requests enable row level security;

revoke all on public.profiles, public.guardian_athletes, public.guardian_consent_requests, public.guardian_consents, public.consent_audit_events, public.data_deletion_requests from anon;
grant select on public.guardian_athletes, public.guardian_consent_requests, public.guardian_consents, public.consent_audit_events, public.data_deletion_requests to authenticated;
grant select, update on public.profiles to authenticated;

create policy "Users read own profile" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "Users update own profile" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "Guardians view linked athletes" on public.guardian_athletes for select to authenticated using (guardian_id = (select auth.uid()) or athlete_id = (select auth.uid()));
create policy "Guardians view their consent requests" on public.guardian_consent_requests for select to authenticated using (lower(guardian_email) = lower(coalesce((select auth.jwt() ->> 'email'), '')));
create policy "Guardians view their consent records" on public.guardian_consents for select to authenticated using (guardian_id = (select auth.uid()) or athlete_id = (select auth.uid()));
create policy "Guardians view relevant audit events" on public.consent_audit_events for select to authenticated using (athlete_id = (select auth.uid()) or exists (select 1 from public.guardian_athletes ga where ga.athlete_id = consent_audit_events.athlete_id and ga.guardian_id = (select auth.uid())));
create policy "Guardians view deletion requests" on public.data_deletion_requests for select to authenticated using (requested_by = (select auth.uid()) or athlete_id = (select auth.uid()) or exists (select 1 from public.guardian_athletes ga where ga.athlete_id = data_deletion_requests.athlete_id and ga.guardian_id = (select auth.uid()) and ga.verified_at is not null));

create or replace function public.grant_guardian_consent(target_athlete_id uuid, consent_scope jsonb, privacy_notice_version text, terms_version text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare caller_id uuid := auth.uid(); consent_id uuid;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.guardian_athletes where guardian_id=caller_id and athlete_id=target_athlete_id and verified_at is not null) then raise exception 'Verified guardian relationship required'; end if;
  insert into public.guardian_consents(guardian_id, athlete_id, status, method, privacy_notice_version, terms_version, consent_scope, granted_at)
  values(caller_id,target_athlete_id,'granted','manual_review',privacy_notice_version,terms_version,consent_scope,now()) returning id into consent_id;
  update public.profiles set account_status='active' where id=target_athlete_id;
  insert into public.consent_audit_events(consent_id,athlete_id,actor_id,action) values(consent_id,target_athlete_id,caller_id,'guardian_consent_granted');
  return consent_id;
end; $$;

create or replace function public.revoke_guardian_consent(target_athlete_id uuid, reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare caller_id uuid := auth.uid(); consent_id uuid;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.guardian_athletes where guardian_id=caller_id and athlete_id=target_athlete_id and verified_at is not null) then raise exception 'Verified guardian relationship required'; end if;
  select id into consent_id from public.guardian_consents where guardian_id=caller_id and athlete_id=target_athlete_id and status='granted' order by created_at desc limit 1 for update;
  if consent_id is null then raise exception 'No active consent found'; end if;
  update public.guardian_consents set status='revoked', revoked_at=now(), revocation_reason=left(reason,500) where id=consent_id;
  update public.profiles set account_status='suspended' where id=target_athlete_id;
  insert into public.consent_audit_events(consent_id,athlete_id,actor_id,action) values(consent_id,target_athlete_id,caller_id,'guardian_consent_revoked');
  return consent_id;
end; $$;

create or replace function public.request_athlete_deletion(target_athlete_id uuid, reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare caller_id uuid := auth.uid(); request_id uuid;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  if not (caller_id=target_athlete_id or exists(select 1 from public.guardian_athletes where guardian_id=caller_id and athlete_id=target_athlete_id and verified_at is not null)) then raise exception 'Not authorized'; end if;
  insert into public.data_deletion_requests(athlete_id,requested_by,request_reason,status) values(target_athlete_id,caller_id,left(reason,500),'identity_verification_required') returning id into request_id;
  update public.profiles set account_status='deletion_requested' where id=target_athlete_id;
  insert into public.consent_audit_events(athlete_id,actor_id,action,metadata) values(target_athlete_id,caller_id,'athlete_deletion_requested',jsonb_build_object('request_id',request_id));
  return request_id;
end; $$;

revoke all on function public.grant_guardian_consent(uuid,jsonb,text,text) from public, anon;
revoke all on function public.revoke_guardian_consent(uuid,text) from public, anon;
revoke all on function public.request_athlete_deletion(uuid,text) from public, anon;
grant execute on function public.grant_guardian_consent(uuid,jsonb,text,text) to authenticated;
grant execute on function public.revoke_guardian_consent(uuid,text) to authenticated;
grant execute on function public.request_athlete_deletion(uuid,text) to authenticated;
