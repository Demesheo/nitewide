const { createManagementService } = require('../services/management-service');

// Legacy transports delegate to the same transactional domain policies as the
// business editor. Controllers never write models or enqueue notifications.
function createManagementController(options) {
  const service = createManagementService(options);
  const created = new Set(['createOrganization', 'addOrgAffiliate', 'createEvent', 'addOffering', 'addEventAffiliate']);
  return Object.fromEntries(Object.entries(service).map(([name, action]) => [name, async (req, res) => {
    const data = await action(req.userId, req.params, req.body);
    if (created.has(name)) res.status(201);
    res.json({ data });
  }]));
}
module.exports = { createManagementController };
