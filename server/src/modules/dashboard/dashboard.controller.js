export function createDashboardController(service) {
  return async (_req, res) => {
    res.json({ data: await service.overview() });
  };
}
