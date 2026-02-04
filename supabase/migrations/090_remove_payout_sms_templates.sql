-- 090_remove_payout_sms_templates.sql
-- Remove payout SMS template flags and templates.

alter table public.sms_settings
  drop column if exists payout_paid_enabled,
  drop column if exists payout_failed_enabled;

update public.sms_messages
set template_code = null
where template_code in ('payout_paid','payout_failed');

delete from public.sms_templates
where code in ('payout_paid','payout_failed');
