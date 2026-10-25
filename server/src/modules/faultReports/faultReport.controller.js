export function createFaultReportController(service) {
  return {
    async create(req, res) {
      res
        .status(201)
        .json({ data: await service.create(req.validated.body, req.actor) });
    },
    async list(req, res) {
      res.json(await service.list(req.validated.query, req.actor));
    },
    async detail(req, res) {
      res.json({
        data: await service.detail(req.validated.params.id, req.actor),
      });
    },
    async resolve(req, res) {
      res.json({
        data: await service.resolve(
          req.validated.params.id,
          req.validated.body,
          req.actor,
        ),
      });
    },
  };
}
