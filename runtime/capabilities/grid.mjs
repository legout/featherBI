import { AllCommunityModule, ModuleRegistry, createGrid } from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);
const grids = new WeakMap();

export const gridCapability = {
 render(node, rows, columns) {
  let api = grids.get(node);
  const columnDefs = columns.map((column) => ({
   field: column.field,
   headerName: column.label ?? column.field,
   sortable: true,
   filter: true,
   onCellClicked: column.dimension ? (event) => node.dispatchEvent(new CustomEvent("featherbi-grid-select", {
    bubbles: true,
    detail: {
     value: event.value,
     dimension: column.dimension,
     action: column.action,
     modifier: Boolean(event.event?.shiftKey || event.event?.metaKey || event.event?.ctrlKey),
    },
   })) : undefined,
  }));
  if (!api) {
   api = createGrid(node, {
    columnDefs,
    rowData: rows,
    defaultColDef: { resizable: true },
    domLayout: "autoHeight",
   });
   grids.set(node, api);
  } else {
   api.setGridOption("columnDefs", columnDefs);
   api.setGridOption("rowData", rows);
  }
 },
 dispose(node) {
  grids.get(node)?.destroy();
  grids.delete(node);
 },
};
