import { autocompletion } from "@codemirror/autocomplete";
import { sql } from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { completionKeymap } from "@codemirror/autocomplete";

export const editorCapability = {
 mount(node, schemas) {
  const schema = Object.fromEntries(Object.entries(schemas).map(([name, columns]) => [name, columns]));
  const view = new EditorView({
   parent: node,
   state: EditorState.create({
    doc: `SELECT * FROM ${Object.keys(schema)[0]} LIMIT 10`,
    extensions: [sql({ schema }), autocompletion(), keymap.of(completionKeymap)],
   }),
  });
  return {
   getValue: () => view.state.doc.toString(),
   setValue(value) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
   },
   dispose: () => view.destroy(),
  };
 },
};
