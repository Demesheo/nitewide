function redactLocation(location) {
  if (!location) return null; const json = location.toJSON();
  if (json.privacy !== 'public') { delete json.addressLine1; delete json.addressLine2; delete json.postalCode; delete json.latitude; delete json.longitude; delete json.geo; }
  return json;
}
function createPublicController({ models }) {
  return {
    listEvents: async (req, res) => {
      const where = { status: 'published', isDiscoverable: true };
      if (req.query.category) where.category = req.query.category;
      const events = await models.Event.findAll({ where, include: [{ model: models.Location, as: 'location' }, { model: models.Organization, as: 'organization', attributes: ['id', 'name', 'slug'] }, { model: models.Offering, as: 'offerings', where: { isActive: true, visibility: 'public' }, required: false }], order: [['startsAt', 'ASC']], limit: Math.min(Number(req.query.limit) || 50, 100) });
      res.json({ data: events.map((event) => ({ ...event.toJSON(), location: redactLocation(event.location) })) });
    },
    getEvent: async (req, res) => {
      const event = await models.Event.findByPk(req.params.eventId, { include: [{ model: models.Location, as: 'location' }, { model: models.Organization, as: 'organization', attributes: ['id', 'name', 'slug'] }, { model: models.Offering, as: 'offerings', where: { isActive: true, visibility: 'public' }, required: false }] });
      if (!event || event.status !== 'published') return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Event not found' } });
      res.json({ data: { ...event.toJSON(), location: redactLocation(event.location) } });
    },
  };
}
module.exports = { createPublicController, redactLocation };

