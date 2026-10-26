// shortcut: v1 has no data migrations; add an ordered, recorded runner with the first schema migration.
console.info(
  'No data migrations required for v1. Critical indexes are ensured at server startup.',
);
