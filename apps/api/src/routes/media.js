const express = require("express");
const multer = require("multer");
const { asyncHandler } = require("../http/middleware");
const { DomainError } = require("../domain/errors");
const {
  createMediaService,
  MAX_IMAGE_BYTES,
} = require("../services/media-service");
function createMediaRouter({ models, requireUser, uploadDir, config, storage }) {
  const router = express.Router();
  const service = createMediaService({ models, uploadDir, config, storage });
  const receive = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0, parts: 2 },
  }).single("image");
  router.post(
    "/business/uploads/image",
    requireUser,
    asyncHandler(async (req, _res, next) => {
      const user = await models.User.findByPk(req.userId);
      if (!user?.isActive)
        throw new DomainError("Active account required", { status: 403 });
      next();
    }),
    (req, res, next) =>
      receive(req, res, (error) => {
        if (error)
          return next(
            new DomainError("Upload one JPG, PNG, or WebP image up to 10 MB", {
              status: 422,
              code: "INVALID_UPLOAD",
            }),
          );
        next();
      }),
    asyncHandler(async (req, res) =>
      res
        .status(201)
        .json({ data: await service.upload(req.userId, req.file?.buffer) }),
    ),
  );
  router.get(
    "/media/images/:assetId",
    asyncHandler(async (req, res) => {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          req.params.assetId,
        )
      )
        return res.sendStatus(404);
      const image = await service.resolve(req.params.assetId);
      if (!image) return res.sendStatus(404);
      if (image.url) {
        // Never cache the redirect beyond its expiring signature.
        res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'cross-origin' });
        return res.redirect(302, image.url);
      }
      res.set({
        "Content-Type": "image/webp",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Cross-Origin-Resource-Policy": "cross-origin",
      });
      res.sendFile(image.filePath, (error) => {
        if (error && !res.headersSent)
          res.sendStatus(error.statusCode === 404 ? 404 : 500);
      });
    }),
  );
  return router;
}
module.exports = { createMediaRouter };
