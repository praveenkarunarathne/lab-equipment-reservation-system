function userSummary(user) {
  return user
    ? { id: user._id.toString(), name: user.name, email: user.email }
    : null;
}

export function faultReportDto(report, admin) {
  const equipment = report.equipmentId;
  return {
    id: report._id.toString(),
    category: report.category,
    title: report.title,
    description: report.description,
    status: report.status,
    resolutionNote: report.resolutionNote,
    resolvedAt: report.resolvedAt?.toISOString() ?? null,
    resolvedBy: userSummary(report.resolvedBy),
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    equipment: equipment
      ? {
          id: equipment._id.toString(),
          assetCode: equipment.assetCode,
          name: equipment.name,
          location: equipment.location,
          status: equipment.status,
          archived: Boolean(equipment.archivedAt),
        }
      : null,
    ...(admin && { reportedBy: userSummary(report.reportedBy) }),
  };
}
