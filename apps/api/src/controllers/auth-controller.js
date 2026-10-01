function createAuthController({ auth }) {
  return {
    register: async (req, res) => res.status(201).json({ data: await auth.register(req.body) }),
    signIn: async (req, res) => res.json({ data: await auth.signIn(req.body) }),
    signInBusiness: async (req, res) => res.json({ data: await auth.signInBusiness(req.body) }),
    me: async (req, res) => res.json({ data: await auth.me(req.userId) }),
    requestPasswordReset: async (req, res) => res.json({ data: await auth.requestPasswordReset(req.body.email) }),
    resetPassword: async (req, res) => res.json({ data: await auth.resetPassword(req.body.token, req.body.password) }),
    verifyEmail: async (req, res) => res.json({ data: await auth.verifyEmail(req.body.token) }),
    requestEmailVerification: async (req, res) => res.json({ data: await auth.requestEmailVerification(req.userId) }),
  };
}

module.exports = { createAuthController };
