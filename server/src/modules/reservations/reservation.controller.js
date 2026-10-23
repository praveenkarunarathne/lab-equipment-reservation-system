export function createReservationController(service) {
  return {
    async create(req, res) {
      res
        .status(201)
        .json({ data: await service.create(req.validated.body, req.actor) });
    },
  };
}
