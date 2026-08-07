insert into public.providers (
  name,
  contact_name,
  email,
  categories,
  lead_time_days,
  status,
  notes
)
select
  'Thermo Fisher Scientific',
  'Laboratory service desk',
  'service@example.invalid',
  array['instrument', 'spare_parts'],
  21,
  'active',
  'Replace the placeholder contact before using this record.'
where not exists (
  select 1 from public.providers where name = 'Thermo Fisher Scientific'
);

insert into public.providers (
  name,
  contact_name,
  email,
  categories,
  lead_time_days,
  status,
  notes
)
select
  'Local laboratory supplier',
  'Purchasing desk',
  'purchasing@example.invalid',
  array['consumables'],
  5,
  'active',
  'Starter record for routine consumables.'
where not exists (
  select 1 from public.providers where name = 'Local laboratory supplier'
);

insert into public.equipment_assets (
  asset_code,
  name,
  manufacturer,
  model,
  location,
  status,
  provider_id,
  last_service_at,
  next_service_at
)
select
  'IRMS-01',
  'Isotope ratio mass spectrometer',
  'Thermo Fisher Scientific',
  'IRMS',
  'Instrument room',
  'active',
  provider.id,
  now() - interval '90 days',
  now() + interval '90 days'
from public.providers as provider
where provider.name = 'Thermo Fisher Scientific'
  and not exists (
    select 1 from public.equipment_assets where asset_code = 'IRMS-01'
  );

insert into public.lab_book_entries (
  entry_type,
  title,
  occurred_at,
  asset_id,
  status,
  performed_by,
  description,
  next_due_at
)
select
  'maintenance',
  'IRMS preventive inspection',
  now() - interval '14 days',
  asset.id,
  'completed',
  'Laboratory team',
  'Visual inspection, leak check, and source condition review completed.',
  now() + interval '76 days'
from public.equipment_assets as asset
where asset.asset_code = 'IRMS-01'
  and not exists (
    select 1
    from public.lab_book_entries
    where title = 'IRMS preventive inspection'
  );

insert into public.backup_records (
  system_name,
  backup_type,
  started_at,
  completed_at,
  status,
  destination,
  verified,
  notes
)
select
  'P2L local database',
  'database',
  now() - interval '1 day 5 minutes',
  now() - interval '1 day',
  'verified',
  'Local encrypted archive',
  true,
  'Starter verification record. Replace it after the first real backup.'
where not exists (
  select 1
  from public.backup_records
  where system_name = 'P2L local database'
);
