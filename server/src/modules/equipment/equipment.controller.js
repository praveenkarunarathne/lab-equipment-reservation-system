export function createEquipmentController(service) {
  return {
    async list(req, res) {
      res.json(await service.list(req.validated.query));
    },
    async detail(req, res) {
      res.json({ data: await service.detail(req.validated.params.id) });
    },
    async create(req, res) {
      res
        .status(201)
        .json({ data: await service.create(req.validated.body, req.actor) });
    },
    async update(req, res) {
      res.json({
        data: await service.update(req.validated.params.id, req.validated.body),
      });
    },
  };
}
