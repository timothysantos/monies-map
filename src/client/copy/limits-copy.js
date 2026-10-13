// Copy for the size caps (src/client/input-limits.js): a quiet count near a
// cap and a plain refusal past it, said before anything is sent. It ships
// with the screens that show them (Entries, Ask, Imports), never with the
// first screen.

const count = (value) => Number(value).toLocaleString("en-SG");

export const limitsCopy = {
  // "1,640 / 2,000": a note or description close to its cap.
  counter: (size, max) => `${count(size)} / ${count(max)}`,
  descriptionTooLong: (max) => `This description is too long to save. Keep it to ${count(max)} characters or fewer.`,
  noteTooLong: (max) => `This note is too long to save. Keep it to ${count(max)} characters or fewer.`,
  // The Ask message box.
  messageLong: (size, max) => `Message is getting long · ${count(size)} / ${count(max)}`,
  messageTooLong: (max) => `This message is too long to send. Keep it to ${count(max)} characters or fewer.`,
  // A receipt photo.
  photoLarge: "This photo is large, so it's made smaller before it's read.",
  photoTooBig: "This photo is too big to send, even made smaller (max 1.5 MB), so it's read on this device instead.",
  // Import help: the mismatch explanation.
  explainTooBig: "This import is too big to explain (max 4 MB). Try a shorter statement."
};
