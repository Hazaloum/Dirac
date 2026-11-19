/** Pasted text is uploaded as a plain-text file, so it goes through the same AI catalogue reading as a document. */
export const PASTED_TEXT_NAME = "Pasted text.txt";

export function textAsFile(text: string): File {
  return new File([text], PASTED_TEXT_NAME, { type: "text/plain" });
}
