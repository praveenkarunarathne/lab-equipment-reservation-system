# Demo rehearsal

Start from the README's local setup or a verified HTTPS deployment. Keep one admin
and one student in separate browser profiles. Use freshly created equipment so
existing history is preserved. Do not reset a shared database for a demonstration.

For a populated development database, run `bun run db:seed-demo` and use the demo
accounts documented in the README. It supplies catalog statuses, history, faults
and Top 5 usage without changing existing records. This command refuses production
mode and skips an existing sample dataset on reruns.

1. Admin: create an equipment item with a unique asset code and inspect its details.
2. Student: register/sign in, search and filter the catalog, choose **Sort by**
   Name A–Z, Name Z–A or Newest first, and apply. Check the order across pages,
   then open the item.
3. Choose a server-returned Asia/Colombo slot and book it. Show the confirmed
   reservation and derived upcoming phase. For a conflict demo, open availability
   in two student tabs before booking; submit the same selected slot in the stale
   second tab. It must conflict and refresh availability.
4. Student: cancel a future booking and show it in History with its reason.
5. Student: book another future slot and submit a text-only fault. Read the safety
   instruction. The report itself must not change equipment availability.
6. Admin: put the item into maintenance with a reason and confirm. Show the future
   reservation cancellation and its maintenance reason.
7. Admin: resolve the fault with a note. The equipment must remain in maintenance.
8. Return the equipment to available. Previously cancelled reservations stay
   cancelled. Edit its metadata and show the changed catalog details.
9. Open Administration: check equipment/status counts, upcoming reservations,
   open faults and the previous-30-day Top 5 table. Fresh future bookings are not
   usage; the isolated E2E fixture and integration tests verify historical counts.
10. Demonstrate safe deletion: archive the demo item with confirmation, show that
    it disappears from the catalog, and show preserved reservation/fault history. Log out;
    protected routes should require sign-in. Students must not access admin pages.

Before the presentation, run all release checks from `DEPLOYMENT.md` and rehearse
these steps. Keep the local MongoDB replica set and Vite setup available as a
fallback, and warm the hosted service before using it.
