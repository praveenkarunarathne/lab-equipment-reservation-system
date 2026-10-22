export function equipmentDto(equipment) {
  return {
    id: equipment._id.toString(),
    assetCode: equipment.assetCode,
    name: equipment.name,
    category: equipment.category,
    location: equipment.location,
    description: equipment.description,
    status: equipment.status,
    statusReason: equipment.statusReason,
    statusUpdatedAt: equipment.statusUpdatedAt.toISOString(),
    createdAt: equipment.createdAt.toISOString(),
    updatedAt: equipment.updatedAt.toISOString(),
  };
}
