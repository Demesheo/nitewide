function createAuthController({ auth }) {
  return {
    register: async (req, res) => res.status(201).json({ data: await auth.register(req.body) }),
    signIn: async (req, res) => res.json({ data: await auth.signIn(req.body) }),
    me: async (req, res) => res.json({ data: await auth.me(req.userId) }),
  };
}

module.exports = { createAuthController };
