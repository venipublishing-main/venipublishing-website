# Veni Reserve migration completion report

**18 November 2026 · Accepted for handover to normal development**

| Area | Decision | Evidence |
| --- | --- | --- |
| Infrastructure and database | Complete | Primary project `droslqfcazwkwvqlbtsq` has all nine Reserve migrations. Final counts were zero businesses and zero Reserve application users. |
| Canonical Veni Account | Accepted | Hosted sign-in and consent used Ian's existing Website identity. Both independent Reserve profiles reached the empty workspace. Cancel preserved both sessions and issued zero grant DELETEs. |
| Hosted security acceptance | Complete | Explicit confirmation revoked the Reserve grant while Website settings remained authenticated. Fresh consent was required on reconnect. The final test showed the same unexpired OAuth bearer accepted before revocation and rejected immediately afterward. |
| Original project | Active, pending a separate retirement decision | `opjgaepryqwmsohtajja` and the primary project both reported healthy. The test left Reserve disconnected. |

The accepted Website release is `aac1382f41dfb1e7bb8bf11d5ee1f74a6700d274`. Staging Worker `dc92dc55-0641-4e88-bb1b-e2cb70a1252c` served 100% of staging traffic. The final test used a private browser context and the deployed Worker's normal bearer validation. A protected workspace read returned HTTP 200, Ian's click produced one HTTP 204 grant DELETE, and the repeated read returned HTTP 401. The provider recorded HTTP 200 and HTTP 403 for the same bearer before and after revocation, with nearly an hour remaining before JWT expiry.

The earlier native-dialog incident remains in the chronological record with its root cause undetermined. The corrected interaction passed the subsequent hosted tests. All conclusions apply to the verified staging releases. [Release ledger and timestamped evidence](reserve-primary-supabase-migration-ledger-20261117.md#18-november-2026--final-hosted-bearer-test)
