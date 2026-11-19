// Read-only helpers for explaining a draft. No publishing or recovery is performed here.
function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalized(value[key])]));
  }
  return value;
}
function same(a, b) { return JSON.stringify(normalized(a)) === JSON.stringify(normalized(b)); }

export function catalogChanges(published, draft) {
  const changes = [];
  for (const section of ['products', 'categories']) {
    const originals = published?.[section];
    const updates = draft?.[section];
    if (!Array.isArray(originals) || !Array.isArray(updates)) throw Error('Catalog review is unavailable; reload before publishing.');
    const before = new Map(originals.map(item => [item.id, item]));
    const after = new Map(updates.map(item => [item.id, item]));
    if (before.size !== originals.length || after.size !== updates.length || [...before.keys(),...after.keys()].some(id => !id)) {
      throw Error('Catalog review found invalid identities; publication is blocked.');
    }
    for (const [id, oldItem] of before) {
      const newItem = after.get(id);
      if (!newItem) {
        changes.push({section, type: 'Removed', name: oldItem.name, before: oldItem, after: null, fields: []});
        continue;
      }
      const fields = [...new Set([...Object.keys(oldItem),...Object.keys(newItem)])]
        .filter(field => !same(oldItem[field], newItem[field]))
        .map(field => ({field, from: oldItem[field], to: newItem[field]}));
      if (fields.length) changes.push({section, type: 'Edited', name: newItem.name, before: oldItem, after: newItem, fields});
    }
    for (const [id, newItem] of after) {
      if (!before.has(id)) changes.push({section, type: 'Added', name: newItem.name, before: null, after: newItem, fields: []});
    }
  }
  return changes;
}

// Only the DRAFT_SAVE that produced the currently loaded version can undo one step.
// Older saves remain preserved in the audit log, not offered as confusing alternatives.
export function oneStepRecovery(events, version) {
  if (!Number.isSafeInteger(version) || !Array.isArray(events)) return null;
  return events.filter(event => event.action === 'DRAFT_SAVE' && event.version === version &&
    Number.isSafeInteger(event.id) && event.before_value && event.after_value)
    .sort((a,b) => b.id-a.id)[0] ?? null;
}

export function manilaDate(timestamp) {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila'
  }).format(date) : 'Date unavailable';
}
