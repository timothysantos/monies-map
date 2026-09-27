// A linked entry request is the Entries page's reading of the `editing_entry`
// URL param: "open this entry's editor". The page acts on each request once.
// It is handled when the page opens that entry (or finds its editor already
// open) or when the person closes the editor, and a handled request never
// reopens the editor, however the page rerenders or refreshes while the
// param is still in the URL. A different param value, including the same
// entry again after the param was cleared, is a new request.

export function createLinkedEntryRequest(entryId = "") {
  return { entryId, handled: false };
}

// The request for the param value now in the URL. Returns the same request
// while the value is unchanged, so a handled request stays handled.
export function syncLinkedEntryRequest(request, entryId = "") {
  return request.entryId === entryId ? request : createLinkedEntryRequest(entryId);
}

// Marks the request handled when it is still the one for `entryId`, so a
// late call for an older link cannot swallow a newer one.
export function markLinkedEntryRequestHandled(request, entryId = request.entryId) {
  if (!request.entryId || request.handled || request.entryId !== entryId) {
    return request;
  }
  return { ...request, handled: true };
}

// The entry the page still has to open, or "" when there is none.
export function getPendingLinkedEntryId(request) {
  return request.entryId && !request.handled ? request.entryId : "";
}
