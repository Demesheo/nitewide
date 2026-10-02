const { z } = require('zod');
const minimum = z.number().int().min(1000).max(100000000);
const organizationCommissionSettings = z.object({ minimumSubtotalCents: minimum }).strict();
const eventCommissionSettings = z.object({ minimumSubtotalCents: minimum.nullable() }).strict();
const organizationPersonCommissionSettings = z.object({ defaultCommissionBps: z.number().int().min(0).max(4000) }).strict();
module.exports = { organizationCommissionSettings, eventCommissionSettings, organizationPersonCommissionSettings };
