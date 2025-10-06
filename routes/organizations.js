import express from 'express';
import {
  createOrganization,
  getOrganization,
  getAllOrganizations,
  updateOrganization,
  deleteOrganization,
  addOrgAffiliate,
  removeOrgAffiliate,
  getOrgAffiliates,
} from '../controllers/organizationController.js';

const router = express.Router();

// CRUD
router.post('/', createOrganization);
router.get('/', getAllOrganizations);
router.get('/:id', getOrganization);
router.put('/:id', updateOrganization);
router.delete('/:id', deleteOrganization);

// Org Affiliates as subresource
router.post('/:id/affiliates', addOrgAffiliate);
router.get('/:id/affiliates', getOrgAffiliates);
router.delete('/:id/affiliates', removeOrgAffiliate);

export default router;
