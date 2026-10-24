export function createReservationController(service) {
  return {
    async list(req, res) {
      res.json(await service.list(req.validated.query, req.actor));
    },
    async cancel(req, res) {
      res.json({
        data: await service.cancel(req.validated.params.id, req.actor),
      });
    },
    async create(req, res) {
      res
        .status(201)
        .json({ data: await service.create(req.validated.body, req.actor) });
    },
  };
}
