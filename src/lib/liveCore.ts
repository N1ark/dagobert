import { Annotation, EditorSelection, StateEffect, StateField, type EditorState, type Extension, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { HistoryLabel } from "./i18n";

/** Shared plumbing of the live editor: what the host, the inline preview and the block widgets agree on. */

/** The undo label a transaction is recorded under in the store's history (`store.touch`). */
export const editLabel = Annotation.define<HistoryLabel>();

/** A transaction bringing the body in from elsewhere (another window, the store's undo): not written back. */
export const external = Annotation.define<boolean>();

const setFocused = StateEffect.define<boolean>();

/** Whether the editor has focus: an unfocused editor reveals no markdown at all. */
export const focusedField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setFocused)) value = e.value;
    return value;
  },
});

/** Keeps `focusedField` in step with the DOM focus. */
export function focusTracking(): Extension {
  return [focusedField, EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing))];
}

/** Source in `from..to` shows as typed (markers and all) when the editor is focused and a selection range touches it. */
export function revealed(state: EditorState, from: number, to: number): boolean {
  if (!state.field(focusedField, false)) return false;
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

/** Replace `from..to` by `insert` as one undoable step labelled `label`. */
export function replaceRange(view: EditorView, from: number, to: number, insert: string, label?: HistoryLabel) {
  view.dispatch({
    changes: { from, to, insert },
    annotations: label ? editLabel.of(label) : [],
    userEvent: "input.live",
  });
}

/** The smallest change turning `doc` into `text`, or null when they're equal. */
export function diff(doc: Text, text: string): { from: number; to: number; insert: string } | null {
  const old = doc.toString();
  if (old === text) return null;
  let start = 0;
  const min = Math.min(old.length, text.length);
  while (start < min && old.charCodeAt(start) === text.charCodeAt(start)) start++;
  let end = 0;
  while (end < min - start && old.charCodeAt(old.length - 1 - end) === text.charCodeAt(text.length - 1 - end)) end++;
  return { from: start, to: old.length - end, insert: text.slice(start, text.length - end) };
}

/** Put the caret at `pos` and focus, keeping the line at `pos` at viewport `y` when given (it was clicked there). */
export function placeCaret(view: EditorView, pos: number, y?: number) {
  view.dispatch({ selection: EditorSelection.cursor(pos), userEvent: "select.pointer" });
  view.focus();
  if (y === undefined) return;
  view.requestMeasure({
    read: () => view.coordsAtPos(pos),
    write: (c) => {
      const scroller = scrollParent(view.dom);
      if (c && scroller) scroller.scrollTop += (c.top + c.bottom) / 2 - y;
    },
  });
}

/** The element the editor scrolls in: the editor itself grows with its content inside `.live`. */
export function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === "auto" || o === "scroll") return p;
  }
  return null;
}
