const { offeringSaleState, eventFinished } = require('../domain/event-policy');
function publicEvent(event) {
  const json = event.toJSON();
  const offerings = event.offerings || [];
  return { ...json, location: redactLocation(event.location), offerings: offerings.filter((o) => o.isActive && o.visibility === 'public').map((o) => {
    const { accessCodeHash, ...tier } = o.toJSON();
    return { ...tier, saleState: eventFinished(event) ? 'closed' : offeringSaleState(o, offerings) };
  }) };
}
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
      const events = await models.Event.findAll({ where, include: [{ model: models.Location, as: 'location' }, { model: models.Organization, as: 'organization', attributes: ['id', 'name', 'slug'] }, { model: models.Offering, as: 'offerings', required: false }], order: [['startsAt', 'ASC']], limit: Math.min(Number(req.query.limit) || 50, 100) });
      res.json({ data: events.map(publicEvent) });
    },
    getEvent: async (req, res) => {
      const event = await models.Event.findByPk(req.params.eventId, { include: [{ model: models.Location, as: 'location' }, { model: models.Organization, as: 'organization', attributes: ['id', 'name', 'slug'] }, { model: models.Offering, as: 'offerings', required: false }] });
      if (!event || event.status !== 'published') return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Event not found' } });
      res.json({ data: publicEvent(event) });
    },
  };
}
module.exports = { createPublicController, redactLocation };
