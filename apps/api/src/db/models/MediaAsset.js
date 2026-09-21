const { DataTypes, Model } = require("sequelize");
const { id } = require("./helpers");
class MediaAsset extends Model {}
function initMediaAsset(sequelize) {
  MediaAsset.init(
    {
      id: id(),
      uploadedByUserId: { type: DataTypes.UUID, allowNull: false },
      storageKey: { type: DataTypes.STRING(80), allowNull: false },
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
