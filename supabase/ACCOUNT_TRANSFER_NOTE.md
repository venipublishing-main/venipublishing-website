# Veni Account transfer note

The Veni Account front end and account-related Supabase source were transferred
from `venipublishing-website-preview` into the release working tree on
31 October 2026.

Imported backend source:
- `migrations/20260903_001_veni_account_foundation.sql`
- `migrations/20260903071048_revoke_handle_new_user_rpc_access.sql`
- `functions/delete-account/`

The existing Veni staging Supabase project already contains the deployed account
backend. Do not blindly re-run the account foundation migration against staging.

The Arcana Stage 3 migration and Arcana front-end tools are deliberately NOT part
of this transfer. Arcana remains a separate later integration phase.