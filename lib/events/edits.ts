/** Event fields an admin can change from an event page; the scrape keeps each one once edited. */
export const LOCKED_FIELDS = ['title', 'location', 'price', 'imageUrl'] as const;
export type LockedField = (typeof LOCKED_FIELDS)[number];

/** The text fields of the edit form (imageUrl changes by uploading a poster). */
export const TEXT_EDIT_FIELDS = ['title', 'location', 'price'] as const;
export type TextEditField = (typeof TEXT_EDIT_FIELDS)[number];

/** Each edited field's value before its first edit, which "Undo edits" puts back. */
export type EditedFields = Partial<Record<LockedField, string | null>>;

/** The fields an admin has edited, in form order. */
export function editedList(edited: EditedFields): LockedField[] {
  return LOCKED_FIELDS.filter((field) => field in edited);
}
