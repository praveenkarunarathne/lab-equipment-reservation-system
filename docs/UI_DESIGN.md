# Labspace UI system

This iteration applies Hallmark and GSAP React to the reservation app.
The audience is students booking laboratory
equipment and administrators managing inventory, reservations and faults.

## Visual decisions

- Preserve Labspace's blue identity, routes, forms, role checks and existing data.
- Treat the equipment ledger as the primary interface. Tables and clear controls
  lead; decorative artwork, repeated icons and status dots do not.
- Keep colors and fonts in `client/src/styles/tokens.css`. Shared styles use those
  tokens for typography, surfaces, focus, inputs and workflow states.
- Use sentence-case labels, readable text, distinct focus outlines and bounded
  content. On phones the catalog keeps names and availability visible; details
  retain the other asset fields.
- Distinguish equipment inventory totals from reservation and fault work queues.

## Motion

GSAP 3.15.0 and `@gsap/react` 2.1.2 animate only mobile navigation and confirmation
dialog state changes: 180 ms, opacity and a small translation, with no load reveal,
count-up effect or scroll animation. `useGSAP` scopes animations to the component;
matchMedia contexts revert on cleanup and menu state changes. The
`prefers-reduced-motion: reduce` preference bypasses these animations.

## Review and limits

Hallmark's rendered sign-in audit checks desktop and mobile layouts. The confirming
run reported no failures and no Reflex findings; three warnings were reviewed:

- The warning rule on a safety notice remains because it signals a safety concern.
- Repeated form/action surfaces are deliberate shared components.
- Mobile sign-in omits desktop explanatory copy while retaining every form control.

The static preservation check retained 28 links, 10 fields and 40 handlers. Range
labels were changed from dash notation to “to”; metadata separators became commas
or colons. The decorative “Laboratory access” label was removed. No application
records, endpoints or permission rules changed. These checks are not a formal
accessibility certification; the rendered audit covers the sign-in route, with
other workflows checked by browser tests and screenshots.
