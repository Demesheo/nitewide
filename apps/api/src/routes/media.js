const express = require("express");
const multer = require("multer");
const path = require("node:path");
const { asyncHandler } = require("../http/middleware");
const { DomainError } = require("../domain/errors");
const {
  createMediaService,
  MAX_IMAGE_BYTES,
} = require("../services/media-service");
function createMediaRouter({ models, requireUser, uploadDir }) {
  const router = express.Router();
  const service = createMediaService({ models, uploadDir });
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
      const asset = await models.MediaAsset.findByPk(req.params.assetId);
      if (!asset || asset.storageKey !== `${asset.id}.webp`)
        return res.sendStatus(404);
      res.set({
        "Content-Type": "image/webp",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Cross-Origin-Resource-Policy": "cross-origin",
      });
      res.sendFile(path.join(service.uploadDir, asset.storageKey), (error) => {
        if (error && !res.headersSent)
          res.sendStatus(error.statusCode === 404 ? 404 : 500);
      });
    }),
  );
  return router;
}
module.exports = { createMediaRouter };
