import { Organization, User, OrgAffiliate } from '../models/index.js';

export const createOrganization = async (req, res) => {
  try {
    const org = await Organization.create(req.body);
    res.status(201).json(org);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getAllOrganizations = async (req, res) => {
  try {
    const orgs = await Organization.findAll({ include: ['orgAffiliates'] });
    res.json(orgs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getOrganization = async (req, res) => {
  try {
    const org = await Organization.findByPk(req.params.id, { include: ['orgAffiliates'] });
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    res.json(org);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateOrganization = async (req, res) => {
  try {
    const org = await Organization.findByPk(req.params.id);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    await org.update(req.body);
    res.json(org);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const deleteOrganization = async (req, res) => {
  try {
    const org = await Organization.findByPk(req.params.id);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    await org.destroy();
    res.json({ message: 'Organization deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --- Org Affiliate Management ---
export const addOrgAffiliate = async (req, res) => {
  try {
    const org = await Organization.findByPk(req.params.id);
    const { userId, role } = req.body;
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    await org.addOrgAffiliate(userId, { through: { role } });
    const affiliates = await org.getOrgAffiliates();
    res.json(affiliates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getOrgAffiliates = async (req, res) => {
  try {
    const org = await Organization.findByPk(req.params.id);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const affiliates = await org.getOrgAffiliates();
    res.json(affiliates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const removeOrgAffiliate = async (req, res) => {
  try {
    const org = await Organization.findByPk(req.params.id);
    const { userId } = req.body;
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    await org.removeOrgAffiliate(userId);
    const affiliates = await org.getOrgAffiliates();
    res.json(affiliates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
