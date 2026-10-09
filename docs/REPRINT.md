# Returning a part for reprint

In a project's **Collection** tab, select **Reprint** beside a printed, post-processing or collected part and provide the assisting staff member's name. The part leaves Collection and returns to the normal **Ready to print** queue. The project reopens in Production, including closed or archived projects.

Only the selected part's current printer and collection details are cleared. Previous print attempts, the original collection details in the audit trail, verification, quote, payment receipt, priority and other parts are preserved. Returning a part does not require a payment receipt; collecting the replacement still follows the existing payment rules.

Print the part using the normal Production actions, then release the project to Collection and collect it again. A project with other collected parts stays in Production until the replacement is explicitly released.

The backend change is `supabase/migrations/20261008143000_return_parts_for_reprint.sql`. It replaces the existing `transition_part_status` function and adds the `RETURN_FOR_REPRINT` action; no new tables or columns are required. The function explicitly allows execution by authenticated and service-role callers and removes any inherited anonymous grant.

Regression checks are in `web/tests/reprint.test.ts` and `supabase/tests/return_for_reprint.sql`. The SQL check runs inside a transaction and rolls its fixtures back; run it against a local test database.
