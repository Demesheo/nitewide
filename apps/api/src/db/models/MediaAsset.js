const { DataTypes, Model } = require("sequelize");
const { id } = require("./helpers");
class MediaAsset extends Model {}
function initMediaAsset(sequelize) {
  MediaAsset.init(
    {
      id: id(),
      uploadedByUserId: { type: DataTypes.UUID, allowNull: false },
      storageKey: { type: DataTypes.STRING(80), allowNull: false },
      storageProvider: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'local' },
      storageBucket: DataTypes.STRING(63),
      status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'ready' },
      managedUpload: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      sha256: DataTypes.STRING(64),
      cleanupAfter: { type: DataTypes.DATE, allowNull: false, defaultValue: () => new Date(Date.now() + 86400000) },
      lastStorageError: DataTypes.STRING(120),
      mimeType: { type: DataTypes.STRING(40), allowNull: false },
      sizeBytes: { type: DataTypes.INTEGER, allowNull: false },
      width: { type: DataTypes.INTEGER, allowNull: false },
      height: { type: DataTypes.INTEGER, allowNull: false },
    },
    { sequelize, modelName: "MediaAsset", tableName: "media_assets" },
  );
  return MediaAsset;
}
module.exports = { initMediaAsset };
