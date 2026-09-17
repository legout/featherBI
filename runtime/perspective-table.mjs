/** Load and configure one new Perspective table, deleting it on failure. */
export async function loadPerspectiveTable(viewer, table, config) {
 try {
  await viewer.load(table);
  await viewer.restore({
   plugin: config.plugin,
   group_by: config.groupBy ?? [],
   split_by: config.splitBy ?? [],
   columns: config.columns,
  });
 } catch (error) {
  try {
   await table.delete();
  } catch {
   // Preserve the actionable load/restore failure.
  }
  throw error;
 }
}
