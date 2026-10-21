import { AllCommunityModule, ModuleRegistry, createGrid } from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);
const grids = new WeakMap();
const appliedSorts = new WeakMap();

const columnSortState = ({ field, direction }, sortIndex) => ({ colId: field, sort: direction, sortIndex });
const sortModel = (api) =>
 api
  .getColumnState()
  .filter((column) => column.sort)
  .sort((left, right) => (left.sortIndex ?? 0) - (right.sortIndex ?? 0))
  .map(({ colId, sort }) => ({ field: colId, direction: sort }));

export const gridCapability = {
 render(node, rows, columns, { paged = false, sort = [] } = {}) {
  let api = grids.get(node);
  const columnDefs = columns.map((column) => ({
   field: column.field,
   headerName: column.label ?? column.field,
   sortable: true,
   // A page-local filter can only hide rows of the current page, so paged
   // tables never offer one (global filtering is not part of the contract).
   filter: !paged,
   cellClassRules: {
    "featherbi-numeric-cell": ({ value }) =>
     typeof value === "number" || typeof value === "bigint",
   },
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
    // A paged grid holds one page only, so a header sort travels to the
    // query as a typed sort model instead of sorting that page locally;
    // sort changes the grid itself re-reports after a render are ignored.
    onSortChanged: paged
     ? (event) => {
        const model = sortModel(event.api);
        if (JSON.stringify(model) === JSON.stringify(appliedSorts.get(node))) return;
        node.dispatchEvent(
         new CustomEvent("featherbi-grid-sort", {
          bubbles: true,
          detail: { sort: model },
         }),
        );
       }
     : undefined,
   });
   grids.set(node, api);
  } else {
   api.setGridOption("columnDefs", columnDefs);
   api.setGridOption("rowData", rows);
  }
  if (paged) {
   // The controller's sort model is authoritative: every render re-applies
   // it so grid and query can never disagree after a page or filter update.
   const state = sort.map(columnSortState);
   appliedSorts.set(node, state.map(({ colId, sort: direction }) => ({ field: colId, direction })));
   api.applyColumnState({ state, defaultState: { sort: null } });
  }
 },
 dispose(node) {
  grids.get(node)?.destroy();
  grids.delete(node);
 },
};
